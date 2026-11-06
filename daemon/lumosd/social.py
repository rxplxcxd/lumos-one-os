"""Universal Social Hub backend (v1.1): links Steam / Xbox Live / PlayStation Network / Nintendo
Switch Online accounts and exposes one normalised API (search, friends + rich presence, chat).

Tokens live in an AES-256-GCM vault (``social.vault`` next to a 0600 key file). Network calls use
the platforms' own HTTP endpoints through ``urllib`` (no extra dependencies). Steam uses the
documented Web API; Xbox uses the official Microsoft device-code flow + Xbox Live services;
PSN and Nintendo have no public APIs – those adapters use the same unofficial endpoints as the
open-source ``psn-api`` / ``nxapi`` projects and are marked ``experimental``.

Normalised friend: {platform, id, name, avatar, status: online|away|busy|offline,
                    game: {name, cover, since?}|None, text, lastSeen, party: {size, max}|None}
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .module import Module
from .server import RpcError

PLATFORMS = ("steam", "xbox", "psn", "nintendo")
EXPERIMENTAL = {"psn", "nintendo"}
UA = "LumosOne/1.1"


# --------------------------------------------------------------------------------- vault
class Vault:
    """AES-256-GCM encrypted JSON store. The key file is created with mode 0600."""

    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self.path = self.dir / "social.vault"
        self.keyfile = self.dir / "social.key"

    def _key(self) -> bytes:
        if self.keyfile.exists():
            return base64.b64decode(self.keyfile.read_text())
        key = os.urandom(32)
        self.dir.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.keyfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(base64.b64encode(key).decode())
        return key

    def load(self) -> dict:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not self.path.exists():
            return {}
        try:
            raw = base64.b64decode(self.path.read_text())
            return json.loads(AESGCM(self._key()).decrypt(raw[:12], raw[12:], b"lumos-social"))
        except Exception:  # noqa: BLE001 - wrong key / corrupt file: start clean, never crash the daemon
            return {}

    def save(self, data: dict) -> None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        nonce = os.urandom(12)
        blob = nonce + AESGCM(self._key()).encrypt(nonce, json.dumps(data).encode(), b"lumos-social")
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(base64.b64encode(blob).decode())
        os.replace(tmp, self.path)


# ----------------------------------------------------------------------------- http helper
def http(url, *, method="GET", headers=None, json_body=None, form=None, timeout=15, follow=True):
    """Blocking HTTP call returning (status, headers, parsed_body). Raises RpcError on network errors."""
    data = None
    h = {"User-Agent": UA, "Accept": "application/json", **(headers or {})}
    if json_body is not None:
        data = json.dumps(json_body).encode()
        h["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode()
        h["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=h, method=method)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):  # noqa: D401
            return None

    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as r:
            body, status, hdrs = r.read(), r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body, status, hdrs = e.read(), e.code, dict(e.headers)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RpcError(f"Netzwerkfehler: {getattr(e, 'reason', e)}", "ENET") from e
    try:
        parsed = json.loads(body) if body else None
    except ValueError:
        parsed = body.decode("utf-8", "replace")[:500]
    return status, hdrs, parsed


def _norm(platform, pid, name, avatar=None, status="offline", game=None, text="", last_seen=None, party=None):
    return {"platform": platform, "id": str(pid), "name": name or str(pid), "avatar": avatar, "status": status, "game": game, "text": text, "lastSeen": last_seen, "party": party}


# ------------------------------------------------------------------------------------ steam
STEAM_STATES = {0: "offline", 1: "online", 2: "busy", 3: "away", 4: "away", 5: "online", 6: "online"}


def steam_player(p: dict) -> dict:
    game = None
    if p.get("gameid"):
        gid = p["gameid"]
        game = {"name": p.get("gameextrainfo") or f"App {gid}", "cover": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{gid}/header.jpg", "id": gid}
    state = STEAM_STATES.get(p.get("personastate", 0), "offline")
    ll = p.get("lastlogoff")
    return _norm("steam", p["steamid"], p.get("personaname"), p.get("avatarfull"), "online" if game and state == "offline" else state, game, "Spielt " + game["name"] if game else "", ll * 1000 if ll else None)


# ---------------------------------------------------------------------------------- module
class SocialModule(Module):
    name = "social"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.vault = Vault(self.cfg.data_dir)
        self.http = http  # replaceable in tests
        self.pending_xbox: dict | None = None

    def methods(self):
        return {
            "social.accounts": self.accounts,
            "social.link": self.link,
            "social.unlink": self.unlink,
            "social.xbox_device_start": self.xbox_device_start,
            "social.xbox_device_poll": self.xbox_device_poll,
            "social.search": self.search,
            "social.friends": self.friends,
            "social.messages": self.messages,
            "social.send": self.send,
            "social.add": self.add,
        }

    # --------------------------------------------------------------------- account storage
    def _store(self) -> dict:
        return self.vault.load()

    async def accounts(self, _p=None):
        s = self._store()
        out = {}
        for pl in PLATFORMS:
            a = s.get(pl)
            out[pl] = {"linked": bool(a), "name": a.get("name") if a else None, "id": a.get("id") if a else None, "experimental": pl in EXPERIMENTAL, "linkedAt": a.get("linkedAt") if a else None}
        return out

    async def unlink(self, p):
        pl = self._platform(p)
        s = self._store()
        s.pop(pl, None)
        self.vault.save(s)
        return {"ok": True}

    def _platform(self, p) -> str:
        pl = str(p.get("platform", ""))
        if pl not in PLATFORMS:
            raise RpcError("Unbekannte Plattform", "EINVAL")
        return pl

    async def link(self, p):
        pl = self._platform(p)
        creds = {k: str(v).strip() for k, v in (p.get("credentials") or {}).items() if v}
        fn = getattr(self, f"_link_{pl}")
        acct = await asyncio.to_thread(fn, creds)
        acct["linkedAt"] = int(time.time() * 1000)
        s = self._store()
        s[pl] = acct
        self.vault.save(s)
        self.log.info("%s verknüpft (%s)", pl, acct.get("name"))
        return {"ok": True, "name": acct.get("name"), "id": acct.get("id")}

    def _acct(self, pl) -> dict:
        a = self._store().get(pl)
        if not a:
            raise RpcError(f"{pl} ist nicht verknüpft", "ENOTLINKED")
        return a

    def _persist(self, pl, acct):
        s = self._store()
        s[pl] = acct
        self.vault.save(s)

    # ------------------------------------------------------------------------------ steam
    def _steam(self, acct, path, **q):
        url = f"https://api.steampowered.com/{path}?" + urllib.parse.urlencode({"key": acct["key"], **q})
        st, _h, body = self.http(url)
        if st in (401, 403):
            raise RpcError("Steam: API-Schlüssel ungültig", "EAUTH")
        if st != 200 or not isinstance(body, dict):
            raise RpcError(f"Steam antwortete mit {st}", "EFAIL")
        return body

    def _steam_resolve(self, acct, text: str) -> str | None:
        text = text.strip().rstrip("/").split("/")[-1]
        if re.fullmatch(r"7656\d{13}", text):
            return text
        r = self._steam(acct, "ISteamUser/ResolveVanityURL/v1/", vanityurl=text).get("response", {})
        return r.get("steamid") if r.get("success") == 1 else None

    def _steam_players(self, acct, ids):
        out = []
        for i in range(0, len(ids), 100):
            out += self._steam(acct, "ISteamUser/GetPlayerSummaries/v2/", steamids=",".join(ids[i : i + 100])).get("response", {}).get("players", [])
        return out

    def _link_steam(self, c):
        if not c.get("key") or not c.get("user"):
            raise RpcError("API-Schlüssel und Steam-Profil (ID oder Vanity-Name) erforderlich", "EINVAL")
        acct = {"key": c["key"]}
        sid = self._steam_resolve(acct, c["user"])
        if not sid:
            raise RpcError("Steam-Profil nicht gefunden", "ENOTFOUND")
        players = self._steam_players(acct, [sid])
        if not players:
            raise RpcError("Steam-Profil nicht gefunden", "ENOTFOUND")
        return {**acct, "id": sid, "name": players[0].get("personaname")}

    def _steam_search(self, q):
        acct = self._acct("steam")
        sid = self._steam_resolve(acct, q)
        hits = self._steam_players(acct, [sid]) if sid else []
        out = [steam_player(p) for p in hits]
        # Steam has no public name search: also match the linked account's friends by name
        ql = q.lower()
        for f in self._steam_friends():
            if ql in f["name"].lower() and all(f["id"] != o["id"] for o in out):
                out.append(f)
        return out

    def _steam_friends(self):
        acct = self._acct("steam")
        fl = self._steam(acct, "ISteamUser/GetFriendList/v1/", steamid=acct["id"], relationship="friend").get("friendslist", {}).get("friends", [])
        return [steam_player(p) for p in self._steam_players(acct, [f["steamid"] for f in fl])]

    # ------------------------------------------------------------------------------ xbox
    MS = "https://login.microsoftonline.com/consumers/oauth2/v2.0"

    async def xbox_device_start(self, p):
        cid = str(p.get("clientId", "")).strip()
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", cid):
            raise RpcError("Azure-Client-ID (GUID) erforderlich – siehe README „Xbox verknüpfen“", "EINVAL")
        _st, _h, r = await asyncio.to_thread(lambda: self.http(f"{self.MS}/devicecode", method="POST", form={"client_id": cid, "scope": "XboxLive.signin offline_access"}))
        if not isinstance(r, dict) or "device_code" not in r:
            raise RpcError(f"Microsoft: {r.get('error_description') if isinstance(r, dict) else r}", "EAUTH")
        self.pending_xbox = {"cid": cid, "device_code": r["device_code"], "expires": time.time() + r.get("expires_in", 900)}
        return {"userCode": r["user_code"], "url": r.get("verification_uri", "https://microsoft.com/link"), "interval": r.get("interval", 5), "expiresIn": r.get("expires_in", 900)}

    async def xbox_device_poll(self, _p=None):
        pend = self.pending_xbox
        if not pend or time.time() > pend["expires"]:
            raise RpcError("Anmeldung abgelaufen – bitte neu starten", "EEXPIRED")
        _st, _h, r = await asyncio.to_thread(lambda: self.http(f"{self.MS}/token", method="POST", form={"client_id": pend["cid"], "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": pend["device_code"]}))
        if isinstance(r, dict) and r.get("error") in ("authorization_pending", "slow_down"):
            return {"status": "pending"}
        if not isinstance(r, dict) or "access_token" not in r:
            raise RpcError(f"Microsoft: {r.get('error_description') if isinstance(r, dict) else r}", "EAUTH")
        acct = {"cid": pend["cid"], "refresh": r["refresh_token"]}
        await asyncio.to_thread(self._xbox_exchange, acct, r["access_token"])
        prof = await asyncio.to_thread(lambda: self._xbox_get(acct, f"https://profile.xboxlive.com/users/xuid({acct['id']})/profile/settings?settings=Gamertag", 2))
        acct["name"] = next((s["value"] for u in prof.get("profileUsers", []) for s in u.get("settings", []) if s["id"] == "Gamertag"), acct["id"])
        acct["linkedAt"] = int(time.time() * 1000)
        s = self._store()
        s["xbox"] = acct
        self.vault.save(s)
        self.pending_xbox = None
        return {"status": "linked", "name": acct["name"]}

    def _xbox_exchange(self, acct, ms_access):
        _s, _h, u = self.http("https://user.auth.xboxlive.com/user/authenticate", method="POST", json_body={"Properties": {"AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": f"d={ms_access}"}, "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"})
        if not isinstance(u, dict) or "Token" not in u:
            raise RpcError("Xbox-Anmeldung fehlgeschlagen", "EAUTH")
        _s, _h, x = self.http("https://xsts.auth.xboxlive.com/xsts/authorize", method="POST", json_body={"Properties": {"SandboxId": "RETAIL", "UserTokens": [u["Token"]]}, "RelyingParty": "http://xboxlive.com", "TokenType": "JWT"})
        if not isinstance(x, dict) or "Token" not in x:
            raise RpcError("Xbox: XSTS-Token verweigert (Konto ohne Xbox-Profil oder Kinderkonto?)", "EAUTH")
        claim = x["DisplayClaims"]["xui"][0]
        acct.update({"xsts": x["Token"], "uhs": claim["uhs"], "id": claim["xid"], "xstsExp": time.time() + 3600 * 15})

    def _xbox_refresh(self, acct):
        if acct.get("xstsExp", 0) > time.time() + 60:
            return
        _s, _h, r = self.http(f"{self.MS}/token", method="POST", form={"client_id": acct["cid"], "grant_type": "refresh_token", "refresh_token": acct["refresh"], "scope": "XboxLive.signin offline_access"})
        if not isinstance(r, dict) or "access_token" not in r:
            raise RpcError("Xbox: Anmeldung abgelaufen – bitte erneut verknüpfen", "EAUTH")
        acct["refresh"] = r.get("refresh_token", acct["refresh"])
        self._xbox_exchange(acct, r["access_token"])
        self._persist("xbox", acct)

    def _xbox_get(self, acct, url, contract=3, method="GET", body=None):
        self._xbox_refresh(acct)
        st, _h, r = self.http(url, method=method, json_body=body, headers={"Authorization": f"XBL3.0 x={acct['uhs']};{acct['xsts']}", "x-xbl-contract-version": str(contract), "Accept-Language": "de-DE"})
        if st == 401:
            acct["xstsExp"] = 0
            raise RpcError("Xbox: nicht autorisiert", "EAUTH")
        if st >= 400:
            raise RpcError(f"Xbox antwortete mit {st}", "EFAIL")
        return r if r is not None else {}

    @staticmethod
    def xbox_person(p: dict) -> dict:
        det = [d for d in (p.get("presenceDetails") or []) if d.get("IsGame")]
        game = {"name": det[0].get("GameDisplayName") or det[0].get("PresenceText"), "cover": None} if det else None
        state = (p.get("presenceState") or "Offline").lower()
        return _norm("xbox", p.get("xuid"), p.get("gamertag") or p.get("displayName"), p.get("displayPicRaw"), "online" if state == "online" else "offline", game, p.get("presenceText") or "", None, None)

    def _xbox_search(self, q):
        acct = self._acct("xbox")
        r = self._xbox_get(acct, "https://peoplehub.xboxlive.com/users/me/people/search/decoration/detail?" + urllib.parse.urlencode({"q": q, "maxItems": 10}), 7)
        return [self.xbox_person(p) for p in r.get("people", [])]

    def _xbox_friends(self):
        acct = self._acct("xbox")
        r = self._xbox_get(acct, "https://peoplehub.xboxlive.com/users/me/people/social/decoration/presenceDetail,detail", 7)
        return [self.xbox_person(p) for p in r.get("people", [])]

    # -------------------------------------------------------------------------------- psn
    PSN_BASIC = "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A="
    PSN = "https://ca.account.sony.com/api/authz/v3/oauth"

    def _link_psn(self, c):
        npsso = c.get("npsso", "")
        if not re.fullmatch(r"[A-Za-z0-9]{40,100}", npsso):
            raise RpcError("NPSSO-Token (64 Zeichen) erforderlich", "EINVAL")
        q = urllib.parse.urlencode({"access_type": "offline", "client_id": "09515159-7237-4370-9b40-3806e67c0891", "response_type": "code", "scope": "psn:mobile.v2.core psn:clientapp", "redirect_uri": "com.scee.psxandroid.scecompcall://redirect"})
        _st, hdr, _b = self.http(f"{self.PSN}/authorize?{q}", headers={"Cookie": f"npsso={npsso}"}, follow=False)
        m = re.search(r"[?&]code=([^&]+)", hdr.get("Location", ""))
        if not m:
            raise RpcError("PSN: NPSSO ungültig oder abgelaufen", "EAUTH")
        acct = {}
        self._psn_token(acct, {"code": m.group(1), "redirect_uri": "com.scee.psxandroid.scecompcall://redirect", "grant_type": "authorization_code"})
        _s, _h, me = self.http("https://m.np.playstation.com/api/userProfile/v1/internal/users/me/profiles", headers={"Authorization": f"Bearer {acct['access']}"})
        prof = (me or {}).get("profile", {}) if isinstance(me, dict) else {}
        acct["name"] = prof.get("onlineId", "PSN-Konto")
        acct["id"] = prof.get("accountId", "me")
        return acct

    def _psn_token(self, acct, form):
        _s, _h, r = self.http(f"{self.PSN}/token", method="POST", headers={"Authorization": self.PSN_BASIC}, form={**form, "scope": "psn:mobile.v2.core psn:clientapp", "token_format": "jwt"})
        if not isinstance(r, dict) or "access_token" not in r:
            raise RpcError("PSN: Token-Austausch fehlgeschlagen", "EAUTH")
        acct.update({"access": r["access_token"], "refresh": r.get("refresh_token", acct.get("refresh")), "exp": time.time() + r.get("expires_in", 3500)})

    def _psn_headers(self, acct):
        if acct.get("exp", 0) < time.time() + 60:
            self._psn_token(acct, {"refresh_token": acct["refresh"], "grant_type": "refresh_token"})
            self._persist("psn", acct)
        return {"Authorization": f"Bearer {acct['access']}"}

    def _psn_search(self, q):
        acct = self._acct("psn")
        st, _h, r = self.http("https://m.np.playstation.com/api/search/v1/universalSearch", method="POST", headers=self._psn_headers(acct), json_body={"searchTerm": q, "domainRequests": [{"domain": "SocialAllAccounts"}]})
        if st >= 400 or not isinstance(r, dict):
            raise RpcError(f"PSN-Suche fehlgeschlagen ({st})", "EFAIL")
        out = []
        for d in r.get("domainResponses", []):
            for it in d.get("results", []):
                sm = it.get("socialMetadata", {})
                if sm.get("accountId"):
                    out.append(_norm("psn", sm["accountId"], sm.get("onlineId"), sm.get("avatarUrl")))
        return out

    def _psn_friends(self):
        acct = self._acct("psn")
        hd = self._psn_headers(acct)
        _s, _h, fr = self.http("https://m.np.playstation.com/api/userProfile/v1/internal/users/me/friends?limit=100", headers=hd)
        ids = (fr or {}).get("friends", []) if isinstance(fr, dict) else []
        pres = {}
        for i in range(0, len(ids), 30):
            _s, _h, pr = self.http("https://m.np.playstation.com/api/userProfile/v1/internal/users/basicPresences?type=primary&accountIds=" + ",".join(ids[i : i + 30]), headers=hd)
            for b in (pr or {}).get("basicPresences", []) if isinstance(pr, dict) else []:
                pres[b["accountId"]] = b
        out = []
        for fid in ids:
            _s, _h, pf = self.http(f"https://m.np.playstation.com/api/userProfile/v1/internal/users/{fid}/profiles", headers=hd)
            prof = (pf or {}).get("profile", {}) if isinstance(pf, dict) else {}
            b = pres.get(fid, {})
            titles = b.get("gameTitleInfoList") or []
            game = {"name": titles[0].get("titleName"), "cover": titles[0].get("conceptIconUrl")} if titles else None
            on = (b.get("primaryPlatformInfo") or {}).get("onlineStatus", "offline")
            av = (prof.get("avatars") or [{}])[0].get("url")
            out.append(_norm("psn", fid, prof.get("onlineId"), av, "online" if on == "online" else "away" if on == "standby" else "offline", game, "Spielt " + game["name"] if game else ""))
        return out

    # --------------------------------------------------------------------------- nintendo
    def _link_nintendo(self, c):
        url = (c.get("bridgeUrl") or "").rstrip("/")
        if not re.fullmatch(r"https?://(127\.0\.0\.1|localhost)(:\d+)?", url):
            raise RpcError("nxapi-Bridge-URL erforderlich (z. B. http://127.0.0.1:12345 – `nxapi nso http-server`)", "EINVAL")
        st, _h, r = self.http(f"{url}/api/znc/friends", headers={"Authorization": f"Bearer {c.get('token', '')}"} if c.get("token") else None)
        if st >= 400 or not isinstance(r, (list, dict)):
            raise RpcError(f"nxapi-Bridge antwortet nicht ({st})", "EFAIL")
        return {"url": url, "token": c.get("token", ""), "id": "nintendo", "name": "Nintendo Switch Online"}

    def _nintendo_friends(self):
        acct = self._acct("nintendo")
        st, _h, r = self.http(f"{acct['url']}/api/znc/friends", headers={"Authorization": f"Bearer {acct['token']}"} if acct.get("token") else None)
        if st >= 400:
            raise RpcError(f"nxapi-Bridge: {st}", "EFAIL")
        lst = r.get("result", r) if isinstance(r, dict) else r
        out = []
        for f in lst or []:
            pr = f.get("presence") or {}
            g = pr.get("game") or {}
            on = pr.get("state") in ("ONLINE", "PLAYING")
            out.append(_norm("nintendo", f.get("nsaId") or f.get("id"), f.get("name"), f.get("imageUri"), "online" if on else "offline", {"name": g["name"], "cover": g.get("imageUri")} if on and g.get("name") else None, ("Spielt " + g["name"]) if on and g.get("name") else "", (pr.get("logoutAt") or 0) * 1000 or None))
        return out

    # --------------------------------------------------------------------------- public API
    def _providers(self, only=None):
        linked = [pl for pl in PLATFORMS if pl in self._store()]
        return [pl for pl in linked if not only or pl in only]

    async def search(self, p):
        q = str(p.get("query", "")).strip()
        if len(q) < 2:
            raise RpcError("Mindestens 2 Zeichen", "EINVAL")
        fns = {"steam": self._steam_search, "xbox": self._xbox_search, "psn": self._psn_search}
        if self.cfg.simulate:
            return {"results": [], "errors": {}}

        async def one(pl):
            return pl, await asyncio.to_thread(fns[pl], q)

        pls = [x for x in self._providers(p.get("platforms")) if x in fns]
        res = await asyncio.gather(*(one(pl) for pl in pls), return_exceptions=True)
        results, errors = [], {}
        for pl, r in zip(pls, res):
            if isinstance(r, Exception):
                errors[pl] = str(r)
            else:
                results += r[1]
        return {"results": results, "errors": errors}

    async def friends(self, p=None):
        fns = {"steam": self._steam_friends, "xbox": self._xbox_friends, "psn": self._psn_friends, "nintendo": self._nintendo_friends}
        if self.cfg.simulate:
            return {"friends": [], "errors": {}}
        pls = self._providers((p or {}).get("platforms"))
        res = await asyncio.gather(*(asyncio.to_thread(fns[pl]) for pl in pls), return_exceptions=True)
        friends, errors = [], {}
        for pl, r in zip(pls, res):
            if isinstance(r, Exception):
                errors[pl] = str(r)
            else:
                friends += r
        return {"friends": friends, "errors": errors}

    # chat: Xbox is bridged through the official xblmessaging service; Steam opens the Steam client
    # (no public chat API); PSN / Nintendo have no usable messaging API.
    CHAT = {"xbox": True, "steam": "deeplink", "psn": False, "nintendo": False}

    def _xbox_conv(self, xuid):
        acct = self._acct("xbox")
        r = self._xbox_get(acct, f"https://xblmessaging.xboxlive.com/network/Xbox/users/me/conversations/users/xuid({xuid})?maxItems=100", 1)
        out = []
        for m in r.get("messages", []):
            txt = "".join(part.get("text", "") for part in (m.get("messageParts") or m.get("parts") or []))
            ts = m.get("timestamp") or ""
            try:
                t = int(time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")) * 1000)
            except ValueError:
                t = int(time.time() * 1000)
            out.append({"id": m.get("messageId") or str(t), "from": m.get("senderXuid") or m.get("sender"), "text": txt, "t": t, "mine": str(m.get("senderXuid")) == str(acct["id"])})
        return out

    async def messages(self, p):
        pl, fid = self._platform(p), str(p.get("friendId", ""))
        if pl != "xbox":
            return {"supported": self.CHAT[pl], "messages": []}
        if self.cfg.simulate:
            return {"supported": True, "messages": []}
        return {"supported": True, "messages": await asyncio.to_thread(self._xbox_conv, fid)}

    async def send(self, p):
        pl, fid, text = self._platform(p), str(p.get("friendId", "")), str(p.get("text", ""))[:1000]
        if pl == "steam":
            return {"ok": True, "deeplink": f"steam://friends/message/{fid}"}
        if pl != "xbox":
            raise RpcError(f"{pl}: Nachrichten werden von der Plattform nicht unterstützt", "EUNSUPPORTED")
        if not text.strip():
            raise RpcError("Leere Nachricht", "EINVAL")
        acct = self._acct("xbox")
        await asyncio.to_thread(lambda: self._xbox_get(acct, f"https://xblmessaging.xboxlive.com/network/Xbox/users/me/conversations/users/xuid({fid})", 1, "POST", {"parts": [{"contentType": "text", "version": 0, "text": text}]}))
        return {"ok": True}

    async def add(self, p):
        """Friend request / follow. Steam & PSN have no public write API → Steam gets a client deep link."""
        pl, fid = self._platform(p), str(p.get("id", ""))
        if pl == "steam":
            return {"ok": True, "deeplink": f"steam://friends/add/{fid}"}
        if pl == "xbox":
            acct = self._acct("xbox")
            await asyncio.to_thread(lambda: self._xbox_get(acct, f"https://social.xboxlive.com/users/me/people/xuid({fid})", 2, "PUT"))
            return {"ok": True}
        raise RpcError(f"{pl}: Freundschaftsanfragen sind über die Plattform-API nicht möglich – bitte direkt in der {pl.upper()}-App senden", "EUNSUPPORTED")

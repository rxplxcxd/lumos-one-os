"""Universal Social Hub backend: vault encryption, Steam/Xbox adapters against mocked HTTP."""
import asyncio
import json
import stat
import types

import pytest

from lumosd.server import RpcError
from lumosd.social import SocialModule, Vault, steam_player


def make(tmp_path, handler):
    ctx = types.SimpleNamespace(cfg=types.SimpleNamespace(data_dir=tmp_path, simulate=False), emit=lambda *a: None)
    m = SocialModule(ctx)
    m.http = handler
    return m


def test_vault_is_encrypted_and_private(tmp_path):
    v = Vault(tmp_path)
    v.save({"steam": {"key": "SECRET-API-KEY-123"}})
    raw = (tmp_path / "social.vault").read_bytes()
    assert b"SECRET-API-KEY" not in raw and b"steam" not in raw
    assert stat.S_IMODE((tmp_path / "social.key").stat().st_mode) == 0o600
    assert Vault(tmp_path).load()["steam"]["key"] == "SECRET-API-KEY-123"
    (tmp_path / "social.vault").write_text("garbage")
    assert Vault(tmp_path).load() == {}  # corrupt vault never crashes the daemon


def test_steam_player_normalisation():
    p = steam_player({"steamid": "7656119800000000", "personaname": "Anna", "avatarfull": "u", "personastate": 1, "gameid": "367520", "gameextrainfo": "Hollow Knight"})
    assert p["status"] == "online" and p["game"]["name"] == "Hollow Knight" and "367520" in p["game"]["cover"]
    off = steam_player({"steamid": "1", "personaname": "B", "personastate": 0, "lastlogoff": 1700000000})
    assert off["status"] == "offline" and off["lastSeen"] == 1700000000000 and off["game"] is None


def steam_http(url, **kw):
    if "ResolveVanityURL" in url:
        return 200, {}, {"response": {"success": 1, "steamid": "76561198000000001"} if "annafps" in url else {"success": 42}}
    if "GetPlayerSummaries" in url:
        return 200, {}, {"response": {"players": [{"steamid": "76561198000000001", "personaname": "AnnaFPS", "personastate": 3}]}}
    if "GetFriendList" in url:
        return 200, {}, {"friendslist": {"friends": [{"steamid": "76561198000000001"}]}}
    raise AssertionError(url)


def test_link_search_friends_steam(tmp_path):
    m = make(tmp_path, steam_http)

    async def run():
        with pytest.raises(RpcError):
            await m.link({"platform": "steam", "credentials": {"key": "k", "user": "nobody"}})
        r = await m.link({"platform": "steam", "credentials": {"key": "k", "user": "annafps"}})
        assert r["name"] == "AnnaFPS"
        acc = await m.accounts()
        assert acc["steam"]["linked"] and not acc["xbox"]["linked"] and acc["psn"]["experimental"]
        assert "key" not in json.dumps(acc)  # secrets never leave the vault
        res = await m.search({"query": "annafps"})
        assert res["results"][0]["platform"] == "steam" and res["errors"] == {}
        fr = await m.friends()
        assert fr["friends"][0]["status"] == "away"
        assert (await m.send({"platform": "steam", "friendId": "7656"}))["deeplink"].startswith("steam://friends/message/")
        with pytest.raises(RpcError):
            await m.send({"platform": "psn", "friendId": "x", "text": "hi"})
        await m.unlink({"platform": "steam"})
        assert not (await m.accounts())["steam"]["linked"]

    asyncio.run(run())


def xbox_http(url, method="GET", form=None, json_body=None, headers=None, **kw):
    if url.endswith("/devicecode"):
        return 200, {}, {"device_code": "dc", "user_code": "ABCD1234", "verification_uri": "https://microsoft.com/link", "interval": 5, "expires_in": 900}
    if url.endswith("/token"):
        xbox_http.polls += 1
        if xbox_http.polls == 1:
            return 400, {}, {"error": "authorization_pending"}
        return 200, {}, {"access_token": "at", "refresh_token": "rt"}
    if "user/authenticate" in url:
        assert json_body["Properties"]["RpsTicket"] == "d=at"
        return 200, {}, {"Token": "ut"}
    if "xsts/authorize" in url:
        return 200, {}, {"Token": "xt", "DisplayClaims": {"xui": [{"uhs": "uhs1", "xid": "2535400000000001"}]}}
    if "profile.xboxlive.com" in url:
        assert headers["Authorization"] == "XBL3.0 x=uhs1;xt"
        return 200, {}, {"profileUsers": [{"settings": [{"id": "Gamertag", "value": "AnnaX"}]}]}
    if "people/social" in url:
        return 200, {}, {"people": [{"xuid": "1", "gamertag": "Ben", "presenceState": "Online", "presenceDetails": [{"IsGame": True, "GameDisplayName": "Halo Infinite"}]}, {"xuid": "2", "gamertag": "Carl", "presenceState": "Offline"}]}
    if "people/search" in url:
        return 200, {}, {"people": [{"xuid": "9", "gamertag": "BenX", "displayPicRaw": "p"}]}
    raise AssertionError(url)


def test_xbox_device_code_flow(tmp_path):
    xbox_http.polls = 0
    m = make(tmp_path, xbox_http)

    async def run():
        with pytest.raises(RpcError):
            await m.xbox_device_start({"clientId": "nope"})
        st = await m.xbox_device_start({"clientId": "00000000-0000-0000-0000-000000000001"})
        assert st["userCode"] == "ABCD1234"
        assert (await m.xbox_device_poll())["status"] == "pending"
        done = await m.xbox_device_poll()
        assert done == {"status": "linked", "name": "AnnaX"}
        fr = (await m.friends())["friends"]
        assert fr[0]["game"]["name"] == "Halo Infinite" and fr[0]["status"] == "online" and fr[1]["status"] == "offline"
        assert (await m.search({"query": "benx"}))["results"][0]["id"] == "9"

    asyncio.run(run())


def test_provider_errors_are_isolated(tmp_path):
    def h(url, **kw):
        if "ResolveVanityURL" in url:
            return 200, {}, {"response": {"success": 1, "steamid": "76561198000000001"}}
        if "GetPlayerSummaries" in url:
            return 200, {}, {"response": {"players": [{"steamid": "76561198000000001", "personaname": "A"}]}}
        return 403, {}, None

    m = make(tmp_path, h)

    async def run():
        await m.link({"platform": "steam", "credentials": {"key": "k", "user": "a"}})
        res = await m.search({"query": "abc"})
        assert "steam" in res["errors"] or res["results"] is not None  # a failing network never raises

    asyncio.run(run())

"""Minimal Valve KeyValues (VDF/ACF text) parser."""
from __future__ import annotations


def parse(text: str) -> dict:
    tokens = _tokens(text)
    root: dict = {}
    stack = [root]
    key = None
    for tok, quoted in tokens:
        if not quoted and tok == "{":
            child: dict = {}
            stack[-1][key] = child
            stack.append(child)
            key = None
        elif not quoted and tok == "}":
            stack.pop()
            key = None
        elif key is None:
            key = tok
        else:
            stack[-1][key] = tok
            key = None
    return root


def _tokens(text: str):
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
        elif c == "/" and text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
        elif c == '"':
            i += 1
            buf = []
            while i < n and text[i] != '"':
                if text[i] == "\\" and i + 1 < n:
                    i += 1
                    buf.append({"n": "\n", "t": "\t"}.get(text[i], text[i]))
                else:
                    buf.append(text[i])
                i += 1
            i += 1
            yield "".join(buf), True
        elif c in "{}":
            i += 1
            yield c, False
        else:
            j = i
            while j < n and not text[j].isspace() and text[j] not in '{}"':
                j += 1
            yield text[i:j], False
            i = j


def ci_get(d: dict, *path, default=None):
    """case-insensitive nested lookup (Steam is inconsistent with key casing)."""
    cur = d
    for p in path:
        if not isinstance(cur, dict):
            return default
        low = {k.lower(): v for k, v in cur.items()}
        cur = low.get(str(p).lower())
        if cur is None:
            return default
    return cur

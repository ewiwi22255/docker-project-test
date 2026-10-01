"""
api/security.py
登入權杖（HMAC 簽章）與「目前使用者」依賴。

權杖只帶帳號與到期時間；每個請求都重新從資料庫載入身分與權限（load_principal），
所以帳號被停權、組織授權被撤銷時，下一個請求就生效，不必等權杖過期。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend import database
from backend.access_control import AccessContext, load_principal

DEFAULT_TTL_SECONDS = 8 * 60 * 60
_bearer = HTTPBearer(auto_error=False)


def _ttl_seconds() -> int:
    try:
        value = int(os.getenv("ERP_API_TOKEN_TTL", "").strip() or DEFAULT_TTL_SECONDS)
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return value if value > 0 else DEFAULT_TTL_SECONDS


def _secret() -> bytes:
    """簽章金鑰：優先用環境變數；沒有就在資料庫旁產生一次並保存（重啟後權杖仍有效）。"""
    configured = os.getenv("ERP_API_SECRET", "").strip()
    if configured:
        return configured.encode("utf-8")
    path = Path(database.DB_FILE).with_name(".api_secret")
    try:
        existing = path.read_bytes().strip()
        if existing:
            return existing
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    value = secrets.token_hex(32).encode("ascii")
    path.write_bytes(value)
    return value


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(username: str, *, now: float | None = None) -> tuple[str, int]:
    issued = int(now if now is not None else time.time())
    expires = issued + _ttl_seconds()
    body = _b64(json.dumps({"sub": username, "iat": issued, "exp": expires}, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{signature}", expires


def verify_token(token: str, *, now: float | None = None) -> str | None:
    """回傳帳號；簽章錯、格式錯、過期一律回 None。"""
    try:
        body, signature = token.split(".", 1)
        expected = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("sub"), str):
        return None
    if int(payload.get("exp", 0)) < int(now if now is not None else time.time()):
        return None
    return payload["sub"]


def current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AccessContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "請先登入")
    username = verify_token(credentials.credentials)
    if not username:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登入已過期，請重新登入")
    principal = load_principal(username)
    if principal is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "帳號已停用或不屬於任何組織")
    return principal

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from pathlib import Path

from .config import get_settings

ADMIN_PASSWORD_FILENAME = "admin-password"
SESSION_SECRET_FILENAME = "session-secret"
SESSION_COOKIE_NAME = "findstuff_session"
SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
SESSION_TOKEN_SCOPE = "v1"
MEDIA_TOKEN_SCOPE = "m1"
MEDIA_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60
MEDIA_PATH_PREFIXES = (
    "/api/v1/photos/",
    "/api/v1/documents/",
    "/api/v1/qr/",
    "/api/v1/labels/",
    "/api/v1/project-files/",
)


def _password_path() -> Path:
    return get_settings().data_dir / ADMIN_PASSWORD_FILENAME


def get_admin_password() -> str:
    path = _password_path()
    try:
        value = path.read_text(encoding="utf-8")
    except OSError:
        return get_settings().admin_password
    return value[:-1] if value.endswith("\n") else value


def credentials_are_valid(username: str, password: str) -> bool:
    settings = get_settings()
    active_password = get_admin_password()
    return bool(active_password) and secrets.compare_digest(
        username,
        settings.admin_username,
    ) and secrets.compare_digest(password, active_password)


def _session_secret(create: bool) -> bytes | None:
    path = get_settings().data_dir / SESSION_SECRET_FILENAME
    try:
        value = bytes.fromhex(path.read_text(encoding="ascii").strip())
        if len(value) == 32:
            return value
    except (OSError, ValueError):
        pass
    if not create:
        return None

    path.parent.mkdir(parents=True, exist_ok=True)
    value = secrets.token_bytes(32)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        try:
            existing = bytes.fromhex(path.read_text(encoding="ascii").strip())
            return existing if len(existing) == 32 else None
        except (OSError, ValueError):
            return None
    with os.fdopen(descriptor, "w", encoding="ascii") as destination:
        destination.write(value.hex() + "\n")
    os.chmod(path, 0o600)
    return value


def _session_signature(expires_at: int, secret: bytes, scope: str = SESSION_TOKEN_SCOPE) -> str:
    settings = get_settings()
    password_digest = hashlib.sha256(get_admin_password().encode()).hexdigest()
    # The scope is part of the signed message, so a read-only media token can
    # never be relabelled into a full session token.
    message = (
        f"{scope}|{expires_at}|{settings.admin_username}|{password_digest}".encode()
    )
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def create_session_token() -> str:
    secret = _session_secret(create=True)
    if secret is None:
        raise OSError("Could not create the session secret")
    expires_at = int(time.time()) + SESSION_MAX_AGE_SECONDS
    return f"{SESSION_TOKEN_SCOPE}.{expires_at}.{_session_signature(expires_at, secret)}"


def _scoped_token_is_valid(token: str, scope: str) -> bool:
    try:
        version, expires_text, supplied_signature = token.split(".", 2)
        expires_at = int(expires_text)
    except (AttributeError, TypeError, ValueError):
        return False
    if version != scope or expires_at < int(time.time()):
        return False
    secret = _session_secret(create=False)
    if secret is None:
        return False
    expected_signature = _session_signature(expires_at, secret, scope)
    return secrets.compare_digest(supplied_signature, expected_signature)


def session_token_is_valid(token: str) -> bool:
    return _scoped_token_is_valid(token, SESSION_TOKEN_SCOPE)


def create_media_token() -> tuple[str, int]:
    """Short-lived, read-only token for images and files the browser loads itself.

    A tab that cannot keep the session cookie (Findstuff framed by another site)
    sends its session as a header, but <img> and <a> requests cannot carry one.
    This token rides in their query string instead, only opens GET requests to
    MEDIA_PATH_PREFIXES, and expires within a day, so one that lands in an
    access log cannot change the inventory.
    """
    secret = _session_secret(create=True)
    if secret is None:
        raise OSError("Could not create the session secret")
    expires_at = int(time.time()) + MEDIA_TOKEN_MAX_AGE_SECONDS
    signature = _session_signature(expires_at, secret, MEDIA_TOKEN_SCOPE)
    return f"{MEDIA_TOKEN_SCOPE}.{expires_at}.{signature}", expires_at


def media_token_is_valid(token: str) -> bool:
    return _scoped_token_is_valid(token, MEDIA_TOKEN_SCOPE)


def save_admin_password(current_password: str, new_password: str) -> None:
    active_password = get_admin_password()
    if not active_password or not secrets.compare_digest(
        current_password,
        active_password,
    ):
        raise PermissionError("Current administrator password is incorrect")
    if len(new_password) < 10:
        raise ValueError("New administrator password must be at least 10 characters")
    if len(new_password) > 256:
        raise ValueError("New administrator password cannot exceed 256 characters")
    if secrets.compare_digest(new_password, active_password):
        raise ValueError("New administrator password must be different")

    path = _password_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(new_password + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    os.chmod(path, 0o600)

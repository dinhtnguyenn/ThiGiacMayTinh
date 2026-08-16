"""Opaque workspace tokens are stored only as keyed digests."""

from __future__ import annotations

import hashlib
import hmac
import secrets


def create_workspace_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str, signing_secret: str) -> str:
    """Use an HMAC so a database dump cannot validate a guessed token on its own."""

    return hmac.new(
        signing_secret.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

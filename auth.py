"""
Authentication utilities for the superpowers MCP service.

Bug fixed: password and token comparisons previously used the ``==`` operator,
which is vulnerable to timing attacks — an attacker can measure response times
to learn whether individual bytes of a secret match, enabling brute-force
attacks character-by-character.  Replaced all such comparisons with
``hmac.compare_digest()``, which always takes the same amount of time
regardless of where the strings diverge.
"""

import hashlib
import hmac
import os
import time


def hash_password(password: str) -> str:
    """Hash a password with a random salt using SHA-256.

    Returns a ``"<salt>:<digest>"`` string suitable for storage.
    """
    salt = os.urandom(16).hex()
    digest = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a plaintext password against its stored hash.

    Uses ``hmac.compare_digest()`` to prevent timing attacks.
    """
    try:
        salt, expected = stored_hash.split(":", 1)
    except ValueError:
        return False
    actual = hashlib.sha256((salt + password).encode()).hexdigest()
    # Previously: `return actual == expected`  ← timing-attack vulnerability
    return hmac.compare_digest(actual, expected)


def generate_api_token(user_id: str, secret: str) -> str:
    """Generate an HMAC-SHA256-signed API token.

    Token format: ``"<user_id>:<unix_timestamp>:<hmac_hex>"``.
    """
    timestamp = str(int(time.time()))
    payload = f"{user_id}:{timestamp}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def verify_api_token(token: str, secret: str, max_age: int = 3600) -> str | None:
    """Verify a signed API token.

    Returns the ``user_id`` on success, or ``None`` if the token is invalid
    or expired.  Uses ``hmac.compare_digest()`` to prevent timing attacks.
    """
    parts = token.split(":")
    if len(parts) != 3:
        return None
    user_id, timestamp, provided_sig = parts

    expected_sig = hmac.new(
        secret.encode(),
        f"{user_id}:{timestamp}".encode(),
        hashlib.sha256,
    ).hexdigest()

    # Previously: `if provided_sig != expected_sig:`  ← timing-attack vulnerability
    if not hmac.compare_digest(provided_sig, expected_sig):
        return None

    try:
        issued_at = int(timestamp)
    except ValueError:
        return None

    if int(time.time()) - issued_at > max_age:
        return None

    return user_id

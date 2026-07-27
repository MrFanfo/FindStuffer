from __future__ import annotations

import asyncio
import socket

import pytest

from findstuff.network_security import (
    validate_allowed_http_host,
    validate_http_url,
    validate_public_http_target,
)


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://user:" + "password@example.com/photo.jpg",
        "//example.com/photo.jpg",
    ],
)
def test_http_url_rejects_unsafe_schemes_and_credentials(url: str) -> None:
    with pytest.raises(ValueError):
        validate_http_url(url)


def test_public_target_rejects_private_dns_resolution(monkeypatch) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))],
    )
    with pytest.raises(ValueError, match="Private or local"):
        asyncio.run(validate_public_http_target("http://images.example/photo.jpg"))


def test_external_image_host_requires_exact_allowlist_match() -> None:
    url = "https://images.openfoodfacts.org/images/product.jpg"
    assert validate_allowed_http_host(url, ("images.openfoodfacts.org",)) == url
    with pytest.raises(ValueError, match="not allowed"):
        validate_allowed_http_host(
            "https://attacker-images.example/photo.jpg",
            ("images.openfoodfacts.org",),
        )

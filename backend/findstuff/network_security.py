from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit


def validate_http_url(url: str) -> str:
    value = url.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("URL must use http:// or https://")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URLs containing credentials are not allowed")
    return value


def validate_allowed_http_host(url: str, allowed_hosts: tuple[str, ...]) -> str:
    value = validate_http_url(url)
    hostname = (urlsplit(value).hostname or "").casefold().rstrip(".")
    if hostname not in allowed_hosts:
        raise ValueError(
            "Image host is not allowed; add it to FINDSTUFF_EXTERNAL_IMAGE_HOSTS first"
        )
    return value


def _resolved_addresses(hostname: str, port: int) -> set[str]:
    return {
        entry[4][0]
        for entry in socket.getaddrinfo(
            hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    }


async def validate_public_http_target(url: str) -> str:
    value = validate_http_url(url)
    parsed = urlsplit(value)
    hostname = parsed.hostname or ""
    if hostname.casefold() == "localhost" or hostname.casefold().endswith(
        (".localhost", ".local", ".internal")
    ):
        raise ValueError("Private or local download targets are not allowed")
    try:
        literal = ipaddress.ip_address(hostname.strip("[]"))
        addresses = {str(literal)}
    except ValueError:
        try:
            addresses = _resolved_addresses(
                hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
            )
        except socket.gaierror as exc:
            raise ValueError("Download target could not be resolved") from exc
    if not addresses:
        raise ValueError("Download target could not be resolved")
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Private or local download targets are not allowed")
    return value

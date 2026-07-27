#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Check:
    name: str
    method: str
    path: str
    body: dict[str, Any] | None
    budget_ms: float


def request(base_url: str, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def timed(base_url: str, check: Check) -> float:
    started = time.perf_counter()
    request(base_url, check.method, check.path, check.body)
    return (time.perf_counter() - started) * 1000


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def create_seed(base_url: str, count: int) -> tuple[str, str]:
    suffix = str(int(time.time()))
    home = request(base_url, "POST", "/api/v1/locations", {
        "name": f"Perf Home {suffix}",
        "kind": "home",
        "parent_public_id": None,
    })
    shelf = request(base_url, "POST", "/api/v1/locations", {
        "name": "Perf Shelf",
        "kind": "shelf",
        "parent_public_id": home["public_id"],
    })
    item = {}
    for index in range(max(1, count)):
        item = request(base_url, "POST", "/api/v1/items", {
            "name": f"Perf Item {suffix}-{index:03d}",
            "description": f"Seeded by scripts/perf-check.py batch {index % 12}",
            "quantity": str((index % 8) + 1),
            "unit": "pcs",
            "location_public_id": shelf["public_id"],
            "expiration_date": "2026-12-31",
            "brand": f"PerfBrand {index % 5}",
        })
    request(base_url, "POST", f"/api/v1/items/{item['public_id']}/maintenance", {
        "title": "Perf maintenance",
        "notes": "",
        "interval_days": 30,
        "last_completed_at": None,
        "next_due_at": "2026-12-31",
    })
    return item["public_id"], home["public_id"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Findstuff responsiveness smoke test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8010", help="Running app URL")
    parser.add_argument("--iterations", type=int, default=8)
    parser.add_argument("--seed", action="store_true", help="Create one item/location for detail checks")
    parser.add_argument("--seed-count", type=int, default=1, help="Number of items to create when seeding")
    parser.add_argument("--item-id", default="")
    parser.add_argument("--location-id", default="")
    args = parser.parse_args()

    try:
        request(args.base_url, "GET", "/api/v1/health")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Findstuff is not reachable at {args.base_url}: {exc}")
        return 2

    item_id = args.item_id
    location_id = args.location_id
    if args.seed or not item_id or not location_id:
        item_id, location_id = create_seed(args.base_url, args.seed_count)

    checks = [
        Check("bootstrap", "GET", "/api/v1/bootstrap", None, 450),
        Check("inventory_search", "GET", "/api/v1/items?q=Perf", None, 260),
        Check("item_detail", "GET", f"/api/v1/items/{item_id}/detail", None, 260),
        Check("location_contents", "GET", f"/api/v1/locations/{location_id}/contents", None, 320),
        Check("dashboard", "GET", "/api/v1/dashboard", None, 160),
    ]

    print(f"Performance check against {args.base_url}")
    print(f"item={item_id} location={location_id} iterations={args.iterations}")
    failures: list[str] = []
    for check in checks:
        samples = [timed(args.base_url, check) for _ in range(max(1, args.iterations))]
        p50 = statistics.median(samples)
        p95 = percentile(samples, 0.95)
        worst = max(samples)
        verdict = "OK" if p95 <= check.budget_ms else "SLOW"
        print(
            f"{check.name:18} p50={p50:7.1f}ms "
            f"p95={p95:7.1f}ms max={worst:7.1f}ms budget={check.budget_ms:5.0f}ms {verdict}"
        )
        if p95 > check.budget_ms:
            failures.append(check.name)
    if failures:
        print("Slow checks:", ", ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

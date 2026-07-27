#!/usr/bin/env python3
"""Fail when publication-sensitive material is present in Git content."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PREFIXES = (
    ".env",
    "data/",
    "backend/data/",
    "graphify-out/",
    "docs/home-locations.findstuff.json",
)
PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}"),
    "OpenAI-style token": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "credential URL": re.compile(r"https?://[^/\s:@]+:[^/\s@]+@"),
    "developer home path": re.compile(r"(?:/home|/Users)/[A-Za-z0-9._-]+/"),
    "RFC1918 IPv4": re.compile(
        r"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b"
    ),
}


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ).stdout


def candidate_paths() -> list[str]:
    output = git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
    return [entry for entry in output.split("\0") if entry]


def scan_text(label: str, text: str) -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        for category, pattern in PATTERNS.items():
            if pattern.search(line):
                findings.append((label, line_number, category))
    return findings


def scan_current() -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    forbidden_seen: set[str] = set()
    for relative in candidate_paths():
        forbidden = next(
            (
                prefix
                for prefix in FORBIDDEN_PREFIXES
                if relative == prefix.rstrip("/") or relative.startswith(prefix)
            ),
            None,
        )
        if forbidden:
            if relative != ".env.example":
                if forbidden not in forbidden_seen:
                    forbidden_seen.add(forbidden)
                    findings.append((forbidden, 0, "forbidden publication path"))
            continue
        path = ROOT / relative
        if not path.is_file() or path.stat().st_size > 5_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        findings.extend(scan_text(relative, text))
    return findings


def scan_history() -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for record in git("log", "--all", "--format=%H%x00%ae").splitlines():
        commit, _, email = record.partition("\0")
        if email and "noreply" not in email.casefold():
            key = ("history", email.casefold(), "non-noreply author email")
            if key not in seen:
                seen.add(key)
                findings.append((f"{commit[:12]}:commit-metadata", 0, key[2]))
    for commit in git("rev-list", "--all").splitlines():
        names = git("ls-tree", "-r", "--name-only", commit).splitlines()
        for relative in names:
            forbidden = next(
                (
                    prefix
                    for prefix in FORBIDDEN_PREFIXES
                    if relative == prefix.rstrip("/") or relative.startswith(prefix)
                ),
                None,
            )
            if forbidden:
                if relative == ".env.example":
                    continue
                key = ("history", forbidden, "forbidden publication path")
                if key not in seen:
                    seen.add(key)
                    findings.append((f"{commit[:12]}:{forbidden}", 0, key[2]))
                continue
            try:
                blob = subprocess.run(
                    ["git", "show", f"{commit}:{relative}"],
                    cwd=ROOT,
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                ).stdout
            except subprocess.CalledProcessError:
                continue
            if len(blob) > 5_000_000:
                continue
            try:
                text = blob.decode("utf-8")
            except UnicodeDecodeError:
                continue
            for path, line, category in scan_text(f"{commit[:12]}:{relative}", text):
                key = ("history", relative, category)
                if key not in seen:
                    seen.add(key)
                    findings.append((path, line, category))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--history",
        action="store_true",
        help="scan every reachable Git revision as well as the publication tree",
    )
    args = parser.parse_args()

    findings = scan_current()
    if args.history:
        findings.extend(scan_history())
    if not findings:
        print("Public-repository check passed.")
        return 0
    print(f"Public-repository check failed with {len(findings)} finding(s):")
    for path, line, category in findings:
        location = f"{path}:{line}" if line else path
        print(f"- {category}: {location}")
    print("Matched content is intentionally redacted.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

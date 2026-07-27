from __future__ import annotations

import math
import sqlite3
from typing import Any


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, parsed)


def _reported_tokens(body: dict[str, Any] | None) -> tuple[int | None, int | None]:
    if not isinstance(body, dict):
        return None, None
    usage = body.get("usage")
    if not isinstance(usage, dict):
        usage = body.get("usage_metadata")
    if not isinstance(usage, dict):
        return None, None
    input_tokens = next(
        (
            parsed
            for key in ("prompt_tokens", "input_tokens", "prompt_token_count")
            if (parsed := _positive_int(usage.get(key))) is not None
        ),
        None,
    )
    output_tokens = next(
        (
            parsed
            for key in ("completion_tokens", "output_tokens", "candidates_token_count")
            if (parsed := _positive_int(usage.get(key))) is not None
        ),
        None,
    )
    return input_tokens, output_tokens


def record_ai_usage(
    connection: sqlite3.Connection,
    *,
    feature: str,
    model: str,
    success: bool,
    response_body: dict[str, Any] | None = None,
    prompt_text: str = "",
    output_text: str = "",
    image_bytes: int = 0,
    original_image_bytes: int = 0,
) -> None:
    reported_input, reported_output = _reported_tokens(response_body)
    input_tokens = (
        reported_input
        if reported_input is not None
        else math.ceil(len(prompt_text) / 4)
    )
    output_tokens = (
        reported_output
        if reported_output is not None
        else math.ceil(len(output_text) / 4)
    )
    estimated = reported_input is None or reported_output is None
    try:
        connection.execute(
            """
            INSERT INTO ai_usage_events(
                feature, model, success, input_tokens, output_tokens,
                token_count_estimated, image_bytes, original_image_bytes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                feature,
                model,
                1 if success else 0,
                input_tokens,
                output_tokens,
                1 if estimated else 0,
                max(0, image_bytes),
                max(0, original_image_bytes),
            ),
        )
    except sqlite3.OperationalError:
        return


def ai_usage_summary(connection: sqlite3.Connection) -> dict[str, Any]:
    try:
        row = connection.execute(
            """
            SELECT count(*) AS calls,
                   COALESCE(sum(success), 0) AS successful_calls,
                   COALESCE(sum(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0)
                       AS failed_calls,
                   COALESCE(sum(input_tokens), 0) AS input_tokens,
                   COALESCE(sum(output_tokens), 0) AS output_tokens,
                   COALESCE(sum(token_count_estimated), 0) AS estimated_calls,
                   COALESCE(sum(CASE WHEN feature = 'scan' THEN 1 ELSE 0 END), 0)
                       AS scan_calls,
                   COALESCE(sum(CASE WHEN feature = 'command' THEN 1 ELSE 0 END), 0)
                       AS command_calls,
                   COALESCE(sum(image_bytes), 0) AS image_bytes,
                   COALESCE(sum(original_image_bytes), 0) AS original_image_bytes
            FROM ai_usage_events
            WHERE created_at >= datetime('now', 'start of month')
            """
        ).fetchone()
        all_time = connection.execute(
            "SELECT count(*) AS calls FROM ai_usage_events"
        ).fetchone()
    except sqlite3.OperationalError:
        row = None
        all_time = None
    values = dict(row) if row is not None else {}
    original_bytes = int(values.get("original_image_bytes", 0))
    sent_bytes = int(values.get("image_bytes", 0))
    return {
        "calls": int(values.get("calls", 0)),
        "successful_calls": int(values.get("successful_calls", 0)),
        "failed_calls": int(values.get("failed_calls", 0)),
        "input_tokens": int(values.get("input_tokens", 0)),
        "output_tokens": int(values.get("output_tokens", 0)),
        "estimated_calls": int(values.get("estimated_calls", 0)),
        "scan_calls": int(values.get("scan_calls", 0)),
        "command_calls": int(values.get("command_calls", 0)),
        "image_bytes": sent_bytes,
        "original_image_bytes": original_bytes,
        "image_bytes_saved": max(0, original_bytes - sent_bytes),
        "all_time_calls": int(all_time["calls"]) if all_time is not None else 0,
    }

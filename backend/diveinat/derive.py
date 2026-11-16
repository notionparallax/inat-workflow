"""Sync between video and dive log, and values derived from it (SPEC §8)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


def solve_sync(points: list[tuple[float, float]]) -> tuple[float, float]:
    """Return (a, b) for t_log = a * t_vid + b from one or two
    (t_vid, t_log) anchor pairs. With one point, a = 1."""
    if not points:
        return 1.0, 0.0
    if len(points) == 1:
        t_vid, t_log = points[0]
        return 1.0, t_log - t_vid
    (v0, l0), (v1, l1) = points[0], points[1]
    if v1 == v0:
        return 1.0, l0 - v0
    a = (l1 - l0) / (v1 - v0)
    return a, l0 - a * v0


def video_to_log(t_vid: float, a: float, b: float) -> float:
    return a * t_vid + b


def interpolate(samples: list[dict[str, Any]], t: float, key: str) -> float | None:
    """Linear interpolation of `key` at log time `t`. None outside the log."""
    if not samples or t < samples[0]["t"] or t > samples[-1]["t"]:
        return None
    lo, hi = 0, len(samples) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if samples[mid]["t"] <= t:
            lo = mid
        else:
            hi = mid
    a, b = samples[lo], samples[hi]
    va, vb = a.get(key), b.get(key)
    if va is None or vb is None:
        return va if vb is None else vb
    if b["t"] == a["t"]:
        return va
    return va + (vb - va) * (t - a["t"]) / (b["t"] - a["t"])


def format_clock(seconds: float) -> str:
    """6740 → '01:52:20'."""
    s = int(round(seconds))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def observation_values(dive: dict[str, Any], t_log: float, utc_offset: str | None = None) -> dict[str, Any]:
    """Time, depth and temperature for an observation at log time `t_log`."""
    offset = utc_offset or dive.get("utc_offset")
    observed = None
    if dive.get("start_local"):
        local = datetime.fromisoformat(dive["start_local"]) + timedelta(seconds=round(t_log))
        observed = local.isoformat() + (offset or "")
    depth = interpolate(dive.get("samples", []), t_log, "depth")
    temp = interpolate(dive.get("samples", []), t_log, "temp")
    return {
        "observed_on": observed,
        "depth_m": round(depth, 1) if depth is not None else None,
        "temp_c": round(temp) if temp is not None else None,
        "dive_time": format_clock(t_log) if t_log >= 0 else None,
        "in_log": depth is not None,
    }

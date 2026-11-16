"""Parser for Subsurface `.ssrf` dive logs (see SPEC §6.2).

Only the fields the tool needs are read: start time, duration, depth and
temperature samples, GPS positions and the dive site name.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")

# A dive is considered "underwater" deeper than this (metres). Used for the
# descent and ascent anchors that sync matches against the video (§8.2).
DEFAULT_THRESHOLD_M = 1.0

_tzfinder = None


def parse_duration(text: str | None) -> float | None:
    """'112:20 min' → 6740.0 seconds. Also accepts 'h:mm:ss min'."""
    if not text:
        return None
    parts = text.replace("min", "").strip().split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    seconds = 0.0
    for n in nums:
        seconds = seconds * 60 + n
    if len(nums) == 1:  # plain minutes
        seconds *= 60
    return seconds


def parse_number(text: str | None) -> float | None:
    """'2.5 m' → 2.5, '20.0 C' → 20.0."""
    if not text:
        return None
    m = _NUMBER.search(text)
    return float(m.group()) if m else None


def parse_latlon(text: str | None) -> tuple[float, float] | None:
    """'-33.915741 151.264138' or '-33.915750, 151.264600' → (lat, lon)."""
    if not text:
        return None
    nums = _NUMBER.findall(text)
    if len(nums) < 2:
        return None
    lat, lon = float(nums[0]), float(nums[1])
    if lat == 0 and lon == 0:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def timezone_for(lat: float, lon: float) -> str | None:
    """IANA time zone name for a position (offline lookup)."""
    global _tzfinder
    if _tzfinder is None:
        from timezonefinder import TimezoneFinder

        _tzfinder = TimezoneFinder()
    return _tzfinder.timezone_at(lat=lat, lng=lon)


def _crossing(t0: float, d0: float, t1: float, d1: float, threshold: float) -> float:
    """Time at which depth crosses `threshold` between two samples (linear)."""
    if d1 == d0:
        return t0
    return t0 + (threshold - d0) * (t1 - t0) / (d1 - d0)


def anchors(samples: list[dict[str, Any]], threshold: float = DEFAULT_THRESHOLD_M) -> tuple[float | None, float | None]:
    """Descent and ascent anchor times: when depth first rises above and last
    falls below `threshold`, interpolated between samples."""
    deep = [i for i, s in enumerate(samples) if s["depth"] >= threshold]
    if not deep:
        return None, None
    first, last = deep[0], deep[-1]
    if first == 0:
        descent = samples[0]["t"]
    else:
        a, b = samples[first - 1], samples[first]
        descent = _crossing(a["t"], a["depth"], b["t"], b["depth"], threshold)
    if last == len(samples) - 1:
        ascent = samples[-1]["t"]
    else:
        a, b = samples[last], samples[last + 1]
        ascent = _crossing(a["t"], a["depth"], b["t"], b["depth"], threshold)
    return round(descent, 2), round(ascent, 2)


def _extradata(dc: ET.Element) -> dict[str, str]:
    return {e.get("key", ""): e.get("value", "") for e in dc.findall("extradata")}


def _parse_dive(dive: ET.Element, sites: dict[str, dict[str, Any]], threshold: float) -> dict[str, Any]:
    computers = dive.findall("divecomputer")
    dc = computers[0] if computers else dive
    extra = _extradata(dc) if computers else {}

    samples: list[dict[str, Any]] = []
    temp: float | None = None
    for s in dc.findall("sample"):
        t = parse_duration(s.get("time"))
        depth = parse_number(s.get("depth"))
        if t is None or depth is None:
            continue
        if s.get("temp") is not None:
            temp = parse_number(s.get("temp"))
        samples.append({"t": t, "depth": depth, "temp": temp})

    # Subsurface only writes temperature when it changes: carry the first
    # known value backwards too, and fall back to the dive summary.
    summary_temp = None
    temp_el = dc.find("temperature")
    if temp_el is not None:
        summary_temp = parse_number(temp_el.get("water"))
    first_temp = next((s["temp"] for s in samples if s["temp"] is not None), summary_temp)
    for s in samples:
        if s["temp"] is None:
            s["temp"] = first_temp
        else:
            break

    depth_el = dc.find("depth")
    site = sites.get(dive.get("divesiteid", ""))

    start_loc = parse_latlon(extra.get("Start location"))
    end_loc = parse_latlon(extra.get("End location"))
    if start_loc:
        location = {"lat": start_loc[0], "lon": start_loc[1], "source": "dive computer"}
    elif site and site.get("lat") is not None:
        location = {"lat": site["lat"], "lon": site["lon"], "source": "dive site"}
    else:
        location = None

    date, time = dive.get("date"), dive.get("time", "00:00:00")
    start_local = f"{date}T{time}" if date else None

    tz_name = timezone_for(location["lat"], location["lon"]) if location else None
    utc_offset = None
    if tz_name and start_local:
        offset = datetime.fromisoformat(start_local).replace(tzinfo=ZoneInfo(tz_name)).utcoffset()
        if offset is not None:
            total = int(offset.total_seconds())
            sign = "+" if total >= 0 else "-"
            total = abs(total)
            utc_offset = f"{sign}{total // 3600:02d}:{(total % 3600) // 60:02d}"

    descent, ascent = anchors(samples, threshold)

    return {
        "number": int(dive.get("number")) if dive.get("number", "").isdigit() else None,
        "start_local": start_local,
        "timezone": tz_name,
        "utc_offset": utc_offset,
        "duration_s": parse_duration(dive.get("duration")),
        "computer": dc.get("model") if computers else None,
        "computer_count": len(computers),
        "max_depth": parse_number(depth_el.get("max")) if depth_el is not None else None,
        "mean_depth": parse_number(depth_el.get("mean")) if depth_el is not None else None,
        "water_temp": summary_temp if summary_temp is not None else first_temp,
        "site": site,
        "location": location,
        "start_location": {"lat": start_loc[0], "lon": start_loc[1]} if start_loc else None,
        "end_location": {"lat": end_loc[0], "lon": end_loc[1]} if end_loc else None,
        "threshold_m": threshold,
        "descent_s": descent,
        "ascent_s": ascent,
        "sample_interval_s": _interval(samples),
        "samples": samples,
    }


def _interval(samples: list[dict[str, Any]]) -> float | None:
    if len(samples) < 2:
        return None
    gaps = sorted(b["t"] - a["t"] for a, b in zip(samples, samples[1:]))
    return gaps[len(gaps) // 2]


def parse_ssrf(text: str | bytes, threshold: float = DEFAULT_THRESHOLD_M) -> list[dict[str, Any]]:
    """Parse a Subsurface log and return its dives (usually one)."""
    root = ET.fromstring(text)
    sites: dict[str, dict[str, Any]] = {}
    for site in root.iter("site"):
        pos = parse_latlon(site.get("gps"))
        sites[site.get("uuid", "")] = {
            "name": site.get("name"),
            "lat": pos[0] if pos else None,
            "lon": pos[1] if pos else None,
        }
    return [_parse_dive(d, sites, threshold) for d in root.iter("dive")]

"""YouTube chapter titles from settled iNat identifications (SPEC §12)."""

from __future__ import annotations

import re
from typing import Any

MIN_CHAPTER_S = 10
_T_PARAM = re.compile(r"youtu\.be/([A-Za-z0-9_-]{11})\?t=(\d+)")


def video_time_from_description(description: str | None, video_id: str) -> int | None:
    """Recover the video time from the link written into the notes."""
    for vid, t in _T_PARAM.findall(description or ""):
        if vid == video_id:
            return int(t)
    return None


def taxon_title(obs: dict[str, Any], unidentified: str) -> str | None:
    taxon = obs.get("taxon")
    if not taxon:
        return unidentified
    name = taxon.get("name")
    common = taxon.get("preferred_common_name")
    if common:
        common = common[0].upper() + common[1:]
        return f"{common} ({name})"
    return name


def format_ts(seconds: int, with_hours: bool) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    if with_hours:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def build_chapters(
    items: list[dict[str, Any]],
    *,
    lead_in: int = 2,
    first_title: str = "Descent",
    research_only: bool = False,
    include_unidentified: bool = True,
    unidentified_title: str = "Unidentified – see iNaturalist",
) -> dict[str, Any]:
    """`items` are {"video_time": seconds, "observation": iNat observation}.

    Returns {"chapters": [{"t", "title"}], "text": str, "warnings": [...]}.
    """
    entries = []
    for item in items:
        obs = item["observation"]
        if research_only and obs.get("quality_grade") != "research":
            continue
        if not obs.get("taxon") and not include_unidentified:
            continue
        title = taxon_title(obs, unidentified_title)
        t = max(0, int(item["video_time"]) - lead_in)
        entries.append((t, title))
    entries.sort(key=lambda e: e[0])

    chapters: list[dict[str, Any]] = [{"t": 0, "titles": [first_title]}]
    for t, title in entries:
        last = chapters[-1]
        if t - last["t"] < MIN_CHAPTER_S:
            if last["t"] == 0 and last["titles"] == [first_title]:
                # Too close to the start for its own chapter: replace "Descent".
                last["titles"] = [title]
            elif title not in last["titles"]:
                last["titles"].append(title)
        else:
            chapters.append({"t": t, "titles": [title]})

    warnings = []
    if len(chapters) < 3:
        warnings.append("YouTube needs at least three chapters; these won't show as chapters yet.")

    with_hours = any(c["t"] >= 3600 for c in chapters)
    out = [{"t": c["t"], "title": " / ".join(c["titles"])} for c in chapters]
    lines = []
    for c in out:
        ts = "00:00" if c["t"] == 0 and not with_hours else format_ts(c["t"], with_hours)
        lines.append(f"{ts} {c['title']}")
    return {"chapters": out, "text": "\n".join(lines), "warnings": warnings}

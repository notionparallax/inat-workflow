"""Observation description (notes) template (SPEC §9.3)."""

from __future__ import annotations

from typing import Any

from . import TOOL_NAME, __version__

_ROWS = ["upper", "middle", "lower"]
_COLS = ["left", "centre", "right"]


def region(x_pct: float, y_pct: float) -> str:
    """Plain-language 3 × 3 region for a point given as percentages."""
    col = _COLS[min(2, int(x_pct // (100 / 3)))]
    row = _ROWS[min(2, int(y_pct // (100 / 3)))]
    if row == "middle" and col == "centre":
        return "centre"
    if row == "middle":
        return f"middle {col}"
    return f"{row} {col}"


def youtube_link(video_id: str, t_vid: float) -> str:
    return f"https://youtu.be/{video_id}?t={int(t_vid)}"


def build_description(
    *,
    video_id: str,
    t_vid: float,
    values: dict[str, Any],
    site_name: str | None,
    location_source: str | None,
    positions: list[dict[str, float] | None],
    crop_of: list[int],
    observer: str | None,
    capturer: str | None,
    free_text: str | None,
    has_gif: bool = False,
) -> str:
    """Build the notes text.

    `positions[i]` is the subject point on still i (percent), or None.
    `crop_of[j]` is the still index (0-based) that detail crop j was cut from.
    Photo numbers in the text follow the upload order: GIF, stills, crops.
    """
    offset = 1 if has_gif else 0
    lines = [f"Video: {youtube_link(video_id, t_vid)}"]
    if values.get("depth_m") is not None:
        lines.append(f"Depth: {values['depth_m']:.1f} m (interpolated from dive computer log)")
    if values.get("temp_c") is not None:
        lines.append(f"Water temperature: {values['temp_c']} °C (dive computer)")
    if site_name:
        lines.append(f"Dive site: {site_name}")
    if location_source:
        lines.append(f"Location: dive entry point ({location_source} GPS), not the exact position of the organism")
    if values.get("dive_time"):
        lines.append(f"Time into dive: {values['dive_time']}")

    pos_parts = []
    for i, p in enumerate(positions):
        if p is None:
            continue
        pos_parts.append(
            f"photo {i + 1 + offset} – {round(p['x'])}% across, {round(p['y'])}% down ({region(p['x'], p['y'])})"
        )
    if pos_parts:
        lines.append("Subject position: " + "; ".join(pos_parts))

    if crop_of:
        first_crop = len(positions) + 1 + offset
        crop_nums = [str(first_crop + j) for j in range(len(crop_of))]
        source_nums = [str(i + 1 + offset) for i in crop_of]
        lines.append(
            f"Photo{'s' if len(crop_of) > 1 else ''} {', '.join(crop_nums)} "
            f"{'are' if len(crop_of) > 1 else 'is a'} full-resolution crop{'s' if len(crop_of) > 1 else ''} "
            f"of photo{'s' if len(crop_of) > 1 else ''} {', '.join(source_nums)}."
        )
    if has_gif:
        lines.append("Photo 1 is an animated GIF from the video.")

    credit = []
    if observer:
        credit.append(f"Observed by: {observer}.")
    if capturer:
        credit.append(f"Frames captured by: {capturer}, with the video owner's permission.")
    if credit:
        lines.append(" ".join(credit))
    if free_text and free_text.strip():
        lines.append(free_text.strip())
    lines.append(f"Created with {TOOL_NAME} v{__version__}")
    return "\n".join(lines)

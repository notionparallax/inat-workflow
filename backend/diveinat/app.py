"""FastAPI back end, run locally on http://localhost:8000 (SPEC §5)."""

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import TOOL_NAME, __version__
from .chapters import build_chapters, video_time_from_description
from .derive import observation_values
from .inat import Client, INatError, build_observation_payload
from .notes import build_description
from .ssrf import parse_ssrf

BACKEND_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


def _load_env() -> None:
    env = BACKEND_DIR / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


_load_env()
app = FastAPI(title=TOOL_NAME, version=__version__)
client = Client(token=os.environ.get("INAT_API_TOKEN") or None)
_terms_cache: list[dict[str, Any]] | None = None


def _token_expiry(token: str | None) -> int | None:
    """Expiry time (Unix seconds) from the JWT's payload, if readable."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return int(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except Exception:
        return None


def _inat_error(exc: INatError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"error": str(exc), "status": exc.status, "body": exc.body})


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "tool": TOOL_NAME, "version": __version__, "token_set": bool(client.token)}


@app.post("/api/dive")
async def dive(file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        dives = parse_ssrf(await file.read())
    except Exception as exc:  # malformed XML etc.
        raise HTTPException(400, f"Couldn't read that file as a Subsurface log: {exc}") from exc
    if not dives:
        raise HTTPException(400, "No dives found in that file.")
    return {"dives": dives}


class TokenIn(BaseModel):
    token: str


@app.post("/api/token")
def set_token(body: TokenIn) -> dict[str, Any]:
    token = body.token.strip()
    if token.startswith("{"):  # pasted the whole {"api_token": "..."} response
        try:
            token = json.loads(token)["api_token"]
        except (ValueError, KeyError) as exc:
            raise HTTPException(400, "That doesn't look like an iNaturalist API token.") from exc
    client.token = token
    return me()


@app.get("/api/me")
def me() -> Any:
    if not client.token:
        return JSONResponse(status_code=401, content={"error": "No token set"})
    try:
        user = client.me()
    except INatError as exc:
        if exc.status == 401:
            return JSONResponse(status_code=401, content={"error": "Token rejected or expired"})
        return _inat_error(exc)
    expires = _token_expiry(client.token)
    return {"id": user["id"], "login": user["login"], "name": user.get("name"),
            "time_zone": user.get("time_zone"),
            "observation_licence": user.get("preferred_observation_license"),
            "photo_licence": user.get("preferred_photo_license"),
            "token_expires_at": expires,
            "token_expires_in_s": expires - int(time.time()) if expires else None}


@app.get("/api/controlled-terms")
def controlled_terms() -> Any:
    global _terms_cache
    if _terms_cache is None:
        try:
            raw = client.controlled_terms()
        except INatError as exc:
            return _inat_error(exc)
        _terms_cache = [
            {"id": t["id"], "label": t["label"], "multivalued": t.get("multivalued", False),
             "taxon_ids": t.get("taxon_ids") or [],
             "values": [{"id": v["id"], "label": v["label"]} for v in t["values"]]}
            for t in raw
        ]
    return {"terms": _terms_cache}


@app.post("/api/observations")
async def create_observation(meta: str = Form(...), photos: list[UploadFile] = File(default=[])) -> Any:
    m = json.loads(meta)
    if not m.get("permission"):
        raise HTTPException(400, "Confirm you have the video owner's permission before uploading.")
    dive = m.get("dive") or {}
    settings = m.get("settings") or {}
    values = observation_values(dive, float(m["t_log"]), m.get("utc_offset")) if dive else {}
    location = dive.get("location")
    site = dive.get("site") or {}
    description = build_description(
        video_id=m["video_id"], t_vid=float(m["t_vid"]), values=values,
        site_name=site.get("name"), location_source=location.get("source") if location else None,
        positions=m.get("positions") or [], crop_of=m.get("crop_of") or [],
        observer=settings.get("observer"), capturer=settings.get("capturer"),
        free_text=settings.get("free_text"), has_gif=bool(m.get("has_gif")),
    )
    field_values = {}
    if settings.get("depth_field_id") and values.get("depth_m") is not None:
        field_values[int(settings["depth_field_id"])] = values["depth_m"]
    if settings.get("temp_field_id") and values.get("temp_c") is not None:
        field_values[int(settings["temp_field_id"])] = values["temp_c"]
    payload = build_observation_payload(
        observed_on=values.get("observed_on"), time_zone=m.get("time_zone") or dive.get("timezone"),
        location=location,
        accuracy_m=settings.get("accuracy_m"), description=description,
        licence=m.get("licence"), field_values=field_values,
    )
    files = [(p.filename or f"photo{i}.jpg", await p.read(), p.content_type or "image/jpeg")
             for i, p in enumerate(photos)]
    annotations = m.get("annotations") or []

    if m.get("dry_run", True):
        return {"dry_run": True, "payload": payload, "values": values,
                "photos": [{"filename": f, "bytes": len(d), "type": t} for f, d, t in files],
                "annotations": annotations, "project_id": settings.get("project_id")}

    progress = dict(m.get("resume") or {})
    progress.setdefault("photos_done", 0)
    progress.setdefault("annotations_done", 0)
    progress.setdefault("dropped_annotations", [])
    try:
        if not progress.get("observation_id"):
            obs = client.create_observation(payload)
            progress["observation_id"] = obs["id"]
            progress["uuid"] = obs.get("uuid")
        for i in range(progress["photos_done"], len(files)):
            filename, data, ctype = files[i]
            client.add_photo(progress["observation_id"], data, filename, ctype)
            progress["photos_done"] = i + 1
        for i in range(progress["annotations_done"], len(annotations)):
            a = annotations[i]
            try:
                client.add_annotation(progress["uuid"], int(a["attribute_id"]), int(a["value_id"]))
            except INatError as exc:
                if exc.status not in (400, 422):
                    raise
                # iNat rejects annotations that don't apply (e.g. taxon-limited ones).
                progress["dropped_annotations"].append({**a, "reason": str(exc.body)})
            progress["annotations_done"] = i + 1
        if settings.get("project_id") and not progress.get("project_done"):
            try:
                client.add_to_project(int(settings["project_id"]), progress["observation_id"])
            except INatError as exc:
                if exc.status not in (400, 422):
                    raise
                progress["project_error"] = str(exc.body)
            progress["project_done"] = True
    except INatError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc), "status": exc.status,
                                                      "body": exc.body, "progress": progress})
    return {"dry_run": False, "observation_id": progress["observation_id"],
            "url": f"https://www.inaturalist.org/observations/{progress['observation_id']}",
            "has_location": bool(location), "progress": progress}


class ChapterItem(BaseModel):
    observation_id: int
    video_time: float


class ChaptersIn(BaseModel):
    video_id: str
    items: list[ChapterItem] = []
    search_if_empty: bool = True
    user_id: int | None = None
    lead_in: int = 2
    first_title: str = "Descent"
    research_only: bool = False
    include_unidentified: bool = True


@app.post("/api/chapters")
def chapters(body: ChaptersIn) -> Any:
    try:
        if body.items:
            obs = {o["id"]: o for o in client.observations([i.observation_id for i in body.items])}
            items = [{"video_time": i.video_time, "observation": obs[i.observation_id]}
                     for i in body.items if i.observation_id in obs]
            source = "saved"
        elif body.search_if_empty:
            found = client.search_video(body.video_id, body.user_id)
            items = []
            for o in found:
                t = video_time_from_description(o.get("description"), body.video_id)
                if t is not None:
                    items.append({"video_time": t, "observation": o})
            source = "search"
        else:
            items, source = [], "none"
    except INatError as exc:
        return _inat_error(exc)
    result = build_chapters(items, lead_in=body.lead_in, first_title=body.first_title,
                            research_only=body.research_only,
                            include_unidentified=body.include_unidentified)
    result["source"] = source
    result["observations"] = [
        {"id": i["observation"]["id"], "video_time": i["video_time"],
         "quality_grade": i["observation"].get("quality_grade"),
         "taxon": (i["observation"].get("taxon") or {}).get("name")}
        for i in items
    ]
    return result


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

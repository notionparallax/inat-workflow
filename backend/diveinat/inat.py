"""Thin iNaturalist API v1 client and payload builder (SPEC §9.2, §10)."""

from __future__ import annotations

import time
from typing import Any

import httpx

from . import TOOL_NAME, __version__

API = "https://api.inaturalist.org/v1"
USER_AGENT = f"{TOOL_NAME}/{__version__}"

# Licence codes as the iNat API accepts them on create (responses use the
# lower-case form, e.g. "cc0").
LICENCES = ["CC0", "CC-BY", "CC-BY-NC", "CC-BY-SA", "CC-BY-ND", "CC-BY-NC-SA", "CC-BY-NC-ND"]


class INatError(Exception):
    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


def build_observation_payload(
    *,
    observed_on: str | None,
    time_zone: str | None = None,
    location: dict[str, Any] | None,
    accuracy_m: int | None,
    description: str,
    licence: str | None,
    field_values: dict[int, Any],
) -> dict[str, Any]:
    """The JSON body for POST /observations. No taxon: identification
    happens on iNat."""
    obs: dict[str, Any] = {"description": description}
    if observed_on:
        obs["observed_on_string"] = observed_on
    if time_zone:
        obs["time_zone"] = time_zone
    if location:
        obs["latitude"] = location["lat"]
        obs["longitude"] = location["lon"]
        if accuracy_m:
            obs["positional_accuracy"] = accuracy_m
    if licence:
        obs["license"] = licence
    ofvs = [
        {"observation_field_id": int(fid), "value": value}
        for fid, value in field_values.items()
        if fid and value is not None
    ]
    if ofvs:
        obs["observation_field_values_attributes"] = ofvs
    return {"observation": obs}


class Client:
    """Minimal client with throttling (≈1 request/s) and retries."""

    def __init__(self, token: str | None = None, min_interval: float = 1.0, retries: int = 3,
                 transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        self.token = token
        self.min_interval = min_interval
        self.retries = retries
        self._last = 0.0
        self._sleep = sleep
        self._http = httpx.Client(base_url=API, headers={"User-Agent": USER_AGENT}, timeout=60,
                                  transport=transport)

    def _headers(self, auth: bool) -> dict[str, str]:
        if not auth:
            return {}
        if not self.token:
            raise INatError("No iNaturalist API token set", status=401)
        return {"Authorization": self.token}

    def request(self, method: str, path: str, *, auth: bool = False, **kwargs) -> Any:
        attempt = 0
        while True:
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                self._sleep(wait)
            self._last = time.monotonic()
            try:
                resp = self._http.request(method, path, headers=self._headers(auth), **kwargs)
            except httpx.TransportError as exc:
                if attempt < self.retries:
                    attempt += 1
                    self._sleep(2 ** attempt)
                    continue
                raise INatError(f"Network error talking to iNaturalist: {exc}") from exc
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt < self.retries:
                    attempt += 1
                    self._sleep(2 ** attempt)
                    continue
            if resp.status_code >= 400:
                try:
                    body = resp.json()
                except ValueError:
                    body = resp.text
                raise INatError(f"iNaturalist returned {resp.status_code} for {method} {path}",
                                status=resp.status_code, body=body)
            if not resp.content:
                return None
            return resp.json()

    # --- Reads (no login needed unless noted) -----------------------------
    def me(self) -> dict[str, Any]:
        return self.request("GET", "/users/me", auth=True)["results"][0]

    def controlled_terms(self) -> list[dict[str, Any]]:
        return self.request("GET", "/controlled_terms")["results"]

    def observations(self, ids: list[int]) -> list[dict[str, Any]]:
        if not ids:
            return []
        return self.request("GET", "/observations", params={"id": ",".join(map(str, ids)),
                                                             "per_page": 200})["results"]

    def search_video(self, video_id: str, user_id: int | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"q": video_id, "search_on": "description", "per_page": 200}
        if user_id:
            params["user_id"] = user_id
        return self.request("GET", "/observations", params=params)["results"]

    # --- Writes --------------------------------------------------------------
    def create_observation(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.request("POST", "/observations", auth=True, json=payload)
        return result[0] if isinstance(result, list) else result

    def add_photo(self, observation_id: int, data: bytes, filename: str, content_type: str) -> Any:
        return self.request("POST", "/observation_photos", auth=True,
                            data={"observation_photo[observation_id]": str(observation_id)},
                            files={"file": (filename, data, content_type)})

    def add_annotation(self, observation_uuid: str, attribute_id: int, value_id: int) -> Any:
        return self.request("POST", "/annotations", auth=True, json={"annotation": {
            "resource_type": "Observation",
            "resource_id": observation_uuid,
            "controlled_attribute_id": attribute_id,
            "controlled_value_id": value_id,
        }})

    def add_to_project(self, project_id: int, observation_id: int) -> Any:
        return self.request("POST", "/project_observations", auth=True, json={
            "project_observation": {"project_id": project_id, "observation_id": observation_id}})

import json
from pathlib import Path

import httpx
import pytest

from diveinat.chapters import build_chapters, video_time_from_description
from diveinat.derive import interpolate, observation_values, solve_sync
from diveinat.inat import Client, INatError, build_observation_payload
from diveinat.notes import build_description, region
from diveinat.ssrf import parse_duration, parse_latlon, parse_ssrf

FIXTURE = Path(__file__).parent / "fixtures" / "gordons_dive.ssrf"


@pytest.fixture(scope="module")
def dive():
    dives = parse_ssrf(FIXTURE.read_bytes())
    assert len(dives) == 1
    return dives[0]


# --- ssrf ------------------------------------------------------------------

def test_parse_helpers():
    assert parse_duration("112:20 min") == 6740
    assert parse_duration("0:10 min") == 10
    assert parse_latlon("-33.915741 151.264138") == (-33.915741, 151.264138)
    assert parse_latlon("-33.915750, 151.264600") == (-33.91575, 151.2646)
    assert parse_latlon("0 0") is None


def test_dive_summary(dive):
    assert dive["number"] == 235
    assert dive["start_local"] == "2026-11-15T08:31:19"
    assert dive["duration_s"] == 6740
    assert dive["computer"] == "Shearwater Perdix 2"
    assert dive["max_depth"] == 13.7
    assert dive["site"]["name"] == "Gordon's bay"
    assert dive["sample_interval_s"] == 10
    assert len(dive["samples"]) == 684


def test_location_prefers_dive_computer(dive):
    assert dive["location"] == {"lat": -33.91575, "lon": 151.2646, "source": "dive computer"}
    assert dive["site"]["lat"] == -33.915741


def test_timezone_from_gps(dive):
    assert dive["timezone"] == "Australia/Sydney"
    assert dive["utc_offset"] == "+11:00"  # daylight saving in November


def test_temperature_carried_forward(dive):
    assert all(s["temp"] == 20.0 for s in dive["samples"])


def test_anchors(dive):
    # 0:10 is 0.0 m and 0:20 is 2.5 m → crossing 1 m at 14 s.
    assert dive["descent_s"] == 14.0
    # 112:30 is 1.5 m and 112:40 is 0.0 m → crossing at ≈6753.3 s.
    assert dive["ascent_s"] == pytest.approx(6753.33, abs=0.01)


# --- derive ----------------------------------------------------------------

def test_solve_sync():
    assert solve_sync([(5.0, 14.0)]) == (1.0, 9.0)
    a, b = solve_sync([(5.0, 14.0), (6005.0, 6020.0)])
    assert a == pytest.approx(1.001)
    assert a * 5 + b == pytest.approx(14.0)


def test_interpolate(dive):
    s = dive["samples"]
    assert interpolate(s, 15, "depth") == pytest.approx(1.25)
    assert interpolate(s, 1, "depth") is None
    assert interpolate(s, 99999, "depth") is None


def test_observation_values(dive):
    v = observation_values(dive, 15)
    assert v["observed_on"] == "2026-11-15T08:31:34+11:00"
    assert v["depth_m"] == 1.2  # 1.25 rounds half-to-even
    assert v["temp_c"] == 20
    assert v["dive_time"] == "00:00:15"


# --- notes -----------------------------------------------------------------

def test_region():
    assert region(10, 10) == "upper left"
    assert region(50, 50) == "centre"
    assert region(90, 50) == "middle right"
    assert region(100, 100) == "lower right"


def test_description():
    text = build_description(
        video_id="MRja6VhCmMs", t_vid=754.6,
        values={"depth_m": 12.4, "temp_c": 20, "dive_time": "00:23:41"},
        site_name="Gordon's bay", location_source="dive computer",
        positions=[{"x": 80, "y": 20}, None], crop_of=[0],
        observer="Diver", capturer="Capturer", free_text="Project note",
    )
    assert "Video: https://youtu.be/MRja6VhCmMs?t=754" in text
    assert "Depth: 12.4 m (interpolated from dive computer log)" in text
    assert "Water temperature: 20 °C" in text
    assert "photo 1 – 80% across, 20% down (upper right)" in text
    assert "Photo 3 is a full-resolution crop of photo 1." in text
    assert "Observed by: Diver. Frames captured by: Capturer" in text
    assert text.splitlines()[-1].startswith("Created with dive-inat v")


# --- iNat payload and client ------------------------------------------------

def test_payload():
    p = build_observation_payload(
        observed_on="2026-11-15T08:31:34+11:00", location={"lat": -33.9, "lon": 151.2},
        accuracy_m=150, description="d", licence="CC0", field_values={558: 12.4, 14913: None},
    )["observation"]
    assert "taxon_id" not in p and "species_guess" not in p
    assert p["positional_accuracy"] == 150
    assert p["license"] == "CC0"
    assert p["observation_field_values_attributes"] == [{"observation_field_id": 558, "value": 12.4}]


def test_payload_without_location():
    p = build_observation_payload(observed_on=None, location=None, accuracy_m=150,
                                  description="d", licence=None, field_values={})["observation"]
    assert "latitude" not in p and "positional_accuracy" not in p


def test_client_retries_then_fails():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503, json={"error": "down"})

    c = Client(token="t", transport=httpx.MockTransport(handler), sleep=lambda s: None)
    with pytest.raises(INatError) as err:
        c.create_observation({"observation": {}})
    assert err.value.status == 503
    assert len(calls) == 4  # first try + 3 retries
    assert calls[0].headers["Authorization"] == "t"


def test_client_recovers_after_retry():
    responses = iter([httpx.Response(429), httpx.Response(200, json=[{"id": 1, "uuid": "u"}])])
    c = Client(token="t", transport=httpx.MockTransport(lambda r: next(responses)), sleep=lambda s: None)
    assert c.create_observation({"observation": {}}) == {"id": 1, "uuid": "u"}


# --- chapters --------------------------------------------------------------

def _obs(taxon=None, grade="needs_id"):
    return {"taxon": taxon, "quality_grade": grade}


def test_chapters_basic():
    sea = {"name": "Phyllopteryx taeniolatus", "preferred_common_name": "weedy seadragon"}
    red = {"name": "Rhodophyta", "preferred_common_name": "red algae"}
    out = build_chapters([
        {"video_time": 467, "observation": _obs(sea, "research")},
        {"video_time": 194, "observation": _obs(red)},
        {"video_time": 200, "observation": _obs(None)},
    ])
    assert out["text"].splitlines() == [
        "00:00 Descent",
        "03:12 Red algae (Rhodophyta) / Unidentified – see iNaturalist",
        "07:45 Weedy seadragon (Phyllopteryx taeniolatus)",
    ]
    assert out["warnings"] == []


def test_chapters_hours_and_filters():
    sea = {"name": "Phyllopteryx taeniolatus", "preferred_common_name": "weedy seadragon"}
    out = build_chapters([
        {"video_time": 4000, "observation": _obs(sea, "research")},
        {"video_time": 300, "observation": _obs(None)},
    ], research_only=True)
    assert out["text"].splitlines() == ["0:00:00 Descent", "1:06:38 Weedy seadragon (Phyllopteryx taeniolatus)"]
    assert out["warnings"]


def test_video_time_from_description():
    d = "Video: https://youtu.be/MRja6VhCmMs?t=754\nDepth: 3 m"
    assert video_time_from_description(d, "MRja6VhCmMs") == 754
    assert video_time_from_description(d, "otherVideo1") is None


# --- API -------------------------------------------------------------------

def test_api_dive_and_dry_run(dive):
    from fastapi.testclient import TestClient

    from diveinat.app import app

    tc = TestClient(app)
    r = tc.post("/api/dive", files={"file": ("d.ssrf", FIXTURE.read_bytes())})
    assert r.status_code == 200 and r.json()["dives"][0]["number"] == 235

    meta = {
        "video_id": "MRja6VhCmMs", "t_vid": 100, "t_log": 600, "dive": dive, "permission": True,
        "licence": "CC0", "positions": [{"x": 50, "y": 50}], "crop_of": [0], "dry_run": True,
        "settings": {"accuracy_m": 150, "depth_field_id": 558, "observer": "A", "capturer": "B"},
        "annotations": [{"attribute_id": 17, "value_id": 18}],
    }
    r = tc.post("/api/observations", data={"meta": json.dumps(meta)},
                files=[("photos", ("1.jpg", b"x" * 10, "image/jpeg")), ("photos", ("2.jpg", b"y", "image/jpeg"))])
    body = r.json()
    assert r.status_code == 200 and body["dry_run"] is True
    obs = body["payload"]["observation"]
    assert obs["observed_on_string"] == "2026-11-15T08:41:19+11:00"
    assert obs["latitude"] == -33.91575
    assert obs["time_zone"] == "Australia/Sydney"
    assert obs["observation_field_values_attributes"][0]["observation_field_id"] == 558
    assert [p["bytes"] for p in body["photos"]] == [10, 1]


def test_api_requires_permission(dive):
    from fastapi.testclient import TestClient

    from diveinat.app import app

    meta = {"video_id": "x", "t_vid": 1, "t_log": 1, "dive": dive, "permission": False}
    r = TestClient(app).post("/api/observations", data={"meta": json.dumps(meta)})
    assert r.status_code == 400

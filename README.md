# Dive iNat

Turn a dive video on YouTube plus a Subsurface dive log into iNaturalist observations. Watch the video, press
**M** when you see something, pick sharp frames, and upload. Time, depth, temperature and location come from the
dive log; identification happens afterwards on iNaturalist. See [SPEC.md](SPEC.md) for the full specification.

Version 1 runs on your own computer: a Python back end, a Svelte front end, and a small Chrome extension that
reads frames from the embedded YouTube player.

## Setup (once)

You need Python 3.12+, Node 20+ and Chrome.

```powershell
# Back end
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt

# Front end
cd ..\frontend
npm install
```

**Extension:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the
`extension` folder. It only runs inside the YouTube player embedded on the tool's own page (`localhost`).

**iNaturalist token (optional here):** you can paste it in the app, or put it in `backend/.env`:

```
INAT_API_TOKEN=eyJ...
```

Tokens come from <https://www.inaturalist.org/users/api_token> and expire after 24 hours. `.env` is ignored by git.

## Running

In two terminals:

```powershell
cd backend;  .venv\Scripts\python -m uvicorn diveinat.app:app --port 8000
cd frontend; npm run dev
```

Then open <http://localhost:5173> in Chrome (signed in to YouTube, or it may refuse to play).

1. **Setup → Video:** paste the YouTube link.
2. **Setup → Dive log:** choose the `.ssrf` file exported from Subsurface.
3. **Sync:** pause where you go under and press **D**; where you surface, press **A**. If the video starts or ends
   mid-dive, set one point and drag the depth profile sideways until it lines up.
4. **Permission:** pick the licence the video owner agreed to and tick the box.
5. **Settings:** observer name, observation fields, and so on. **Dry run is on by default**: uploads only show
   what would be sent. Turn it off in Settings when you're ready for real uploads.

Then watch: **M** captures a burst of frames around the moment and opens them full-screen; arrow keys move between frames, **Space** or **1–9** selects up to four stills, and
clicking the organism marks where it is. **C** goes to
annotations, **Enter** uploads. The **Shortcuts** button lists every key.

## Tests

```powershell
cd backend;  .venv\Scripts\python -m pytest     # parser, sync, notes, chapters, payloads, API
cd frontend; npm test                           # sync and helper maths
```

`scripts/` has two Playwright scripts (`npm install` there first):

- `smoke-ui.mjs` loads the app with the sample dive and takes screenshots (needs both servers running).
- `test-grabber.mjs` tries the extension against a real video. YouTube currently shows automated browsers a
  “confirm you're not a bot” screen, so the real extension test has to be done by hand in your own Chrome.

## Layout

| Folder | What |
| --- | --- |
| `backend/diveinat/` | `ssrf.py` log parser · `derive.py` sync and interpolation · `notes.py` notes template · `chapters.py` YouTube chapters · `inat.py` iNat client · `app.py` HTTP API |
| `frontend/src/` | Svelte app: player, timeline and depth profile, observation workflow, setup, settings, chapters |
| `extension/` | Frame grabber (Manifest V3 content script) |
| `scripts/` | Playwright test scripts |

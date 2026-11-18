# Dive video → iNaturalist: specification

Status: draft v0.6 (2026-11-16). First build (v0.1.0) in this repository.

## 1. Purpose

Divers who film with a head-mounted camera collect hours of footage full of organisms worth recording on iNaturalist. Turning that footage into observations by hand currently takes a couple of hours per dive, so only the most exciting sightings get recorded. Most of the metadata needed (time, depth, water temperature, entry location) already exists in the dive computer's log.

This tool lets a user watch a dive video on YouTube, mark organisms as they appear, choose sharp frames, and upload each one as an iNaturalist observation. Time, depth, temperature and location are filled in automatically from the dive log. Identification happens afterwards, on iNaturalist, by the uploader and the iNat community.

A secondary aim is scientific. A marine scientist collaborator wants research-grade records and an analysable dataset, especially of marine plants and algae, which iNat's mostly animal-focused users under-record. Lowering the cost per observation should raise the number and variety of observations per dive. A paper with the scientist will be about the resulting data; the tool will appear in its methods, not as its subject.

## 2. Principles

1. **Thin.** iNaturalist is the record. The tool doesn't identify species, doesn't archive, doesn't export datasets and doesn't duplicate any iNat feature. Its only job is producing well-formed observations quickly.
2. **No video hosting or handling.** Videos stay on YouTube. Users can't upload video files, and the tool never downloads video files.
3. **Permission first.** The person capturing frames may not own the video. They must confirm explicit permission from the video's owner before uploading anything.
4. **Credit both people.** The diver who observed the organism and the person who captured the frames are credited separately.
5. **Assume nothing the data doesn't say.** Annotations stay unset unless the user sets them. Values derived from the log (such as interpolated depth) are labelled as derived.

## 3. Users and roles

| Role | Description |
| --- | --- |
| **Diver (observer)** | Filmed the dive and owns the video and dive log. May also be the capturer. |
| **Capturer** | Uses the tool to make observations. Uploads under their own iNat account. Needs the diver's permission and dive log. |
| **Consumer (e.g. the scientist)** | Doesn't use the tool. Works from the resulting observations on iNaturalist, typically through an iNat project. |

Initial users: the author and one marine scientist. Target users: anyone who wants iNat observations from continuous video, not only divers. Diving-specific features (the dive log) should be optional where practical.

## 4. Scope by phase

### Version 1 (static site, soft launch)

- A static Svelte site with no back end (§5), hosted on GitHub Pages at `notionparallax.github.io/inat-workflow`, plus the frame grabber extension (§7.2) in Chrome or Edge. Until the extension is in the Chrome Web Store, users load it unpacked from a zip the site offers.
- A first-visit introduction that explains the tool and how to install the extension.
- Inputs: a YouTube URL, a Subsurface `.ssrf` file containing a single dive, and a pasted iNat API token.
- Manual video ↔ log sync (two-point click, or dragging the profile along the timeline).
- Depth profile under the video timeline, clickable to jump the video.
- Modal observation workflow: start → capture frames → set annotations → complete → upload.
- Frame capture with burst + automatic sharpness ranking (see §7).
- Upload of stills with time, location, depth, temperature, notes template, observation fields and annotations.
- A timestamped YouTube link in every observation's notes.
- Subject position (*x*% / *y*%) on each still, written into the notes.
- Optional crop box on each still, uploaded as an extra photo (§9.9).
- Animated GIF of a stretch of video around a frame, made in the browser and uploaded as the first photo (§9.7).
- YouTube chapter titles generated from settled identifications, as copy-paste text.
- Timeline markers for captured observations and shading for reviewed sections, saved in browser storage.
- Keyboard-first controls.

### Version 1.5

- Downloading an observation's captured frames as a bundle, so they can be reused later.

### Version 2

- OAuth login with iNaturalist (app registered under the author's account).
- Optional colour correction for underwater colour casts.
- No-log mode for video without a dive log (e.g. non-divers): time from a manually entered start time, location set on iNat (as in §9.10), and no depth or temperature.
- Optionally add a GPS trace, so if there's a GPS log, the time stamp can join the location with the image time stamp (this is prototyped in this repo: [notionparallax: dive-map](https://github.com/notionparallax/dive-map))

### Later / not decided

- Multiple dives in one video, and one dive across several videos.
- Drift dives (location interpolated along the route by elapsed time).
- Writing media or iNat links back into the Subsurface log.
- Adding frames to an observation after it has been completed.
- Duplicates across capturers: showing other people's iNat observations of the same video on the timeline (found by searching for the video link, as in §12.1).
- Dive computers other than Shearwater via Subsurface; other log formats.

## 5. System overview

```txt
┌──────────────────────── Browser (Svelte, static files) ────────────┐
│  YouTube IFrame player    │  Filmstrip / observation form          │
│  Timeline + depth profile │  Settings, permission, token           │
│  .ssrf parser, sync maths, time zone from GPS, notes, chapters     │
│  iNat client (fetch, throttling, retry)                            │
│        ▲ frames + media times (postMessage)                        │
│  ┌─────┴──────────────────────┐                                    │
│  │ Frame grabber extension    │  runs inside the YouTube embed     │
│  │ (content script, §7)       │  frame only                        │
│  └────────────────────────────┘   frames → memory                  │
└───────────────┬────────────────────────────────────────────────────┘
                │ HTTPS (direct; the API allows cross-origin calls)
          api.inaturalist.org
```

There is no back end (decided 2026-11-18). The site is a set of static files, so hosting is free and there's no server to run. Frames, GIFs and the dive log stay in the browser until they're uploaded straight to iNaturalist.

**Why it works.** The iNat API allows calls from any web page. Checked 2026-11-17 and again 2026-11-18: pre-flight (CORS) requests to `api.inaturalist.org/v1/observations` and `/v1/observation_photos` return `Access-Control-Allow-Origin: *` and allow the `Authorization` header with GET, POST, PUT and DELETE.

**Where the old Python back end's jobs went** (v0.1.x → v0.2):

| Job | In the browser (`frontend/src/lib/`) |
| --- | --- |
| `.ssrf` parsing | `ssrf.js`, using `DOMParser`. Gives identical output to the Python parser on the sample dive. |
| Sync maths, interpolation | `dive.js` |
| Notes, chapters | `notes.js`, `chapters.js` |
| Time zone from GPS | `@photostructure/tz-lookup` (offline, ≈70 kB; can be coarse within a few km of a border), with the UTC offset from `Intl` |
| iNat client | `inat.js`: `fetch`, one request at a time, ≈1 per second, retries on 429 and 5xx (§10) |
| Holding the token | `localStorage` in the user's browser, cleared when it expires |

**Token exposure.** The token lives in browser storage and is sent only to iNat. Any cross-site scripting flaw on the site could read it; the 24-hour expiry limits the damage. The site loads no third-party scripts other than the YouTube player API.

## 6. Inputs

### 6.1 YouTube video

- Entered as a URL. Embedded with the YouTube IFrame Player API.
- The tool asks the user to select the highest playback quality (ideally 2160p) and warns if the resolution actually playing is below the source (§7.2).
- The video must allow embedding, and must be public or unlisted (private videos can't be embedded).
- Video ID is the key for all saved state.

### 6.2 Dive log (Subsurface `.ssrf`)

The user exports a single dive from Subsurface (desktop or mobile). A capturer who isn't the diver gets this file from the diver.

Checked against a real export (`gordons_dive.ssrf`, Perdix 2, firmware 102, Subsurface log format version 3). The parser reads:

| Data | Where in `.ssrf` | Use |
| --- | --- | --- |
| Dive start date and time (local, no time zone) | `<dive date='2026-11-15' time='08:31:19'>` | Observation time |
| Duration | `<dive duration='112:20 min'>` | Sync check |
| Dive number | `<dive number='235'>` | Notes (optional) |
| Depth samples | `<sample time='m:ss min' depth='x.x m'>`, every 10 s | Depth profile; per-observation depth |
| Water temperature | `temp='20.0 C'` on a sample, **written only when it changes**, so carried forward to later samples. Summary in `<temperature water='…'>` | Per-observation temperature |
| Max and mean depth | `<depth max='…' mean='…'>` | Notes (optional) |
| Start and end GPS position from the dive computer | `<extradata key='Start location' value='lat, lon'>` and `key='End location'` | Observation location (preferred) |
| Dive site name and GPS position | `<divesites><site name='…' gps='lat lon'>`, linked by `<dive divesiteid='…'>` | Site name in notes; position as fallback |

Ignored: tank pressures, gas events, deco data, fingerprints, filter presets, buddy and suit.

Findings from the sample:

- **Two positions.** The dive computer's start location and the Subsurface dive site's position differ by ≈43 m. The parser prefers the computer's start location, because it's recorded for this specific dive, and falls back to the site position. Start and end locations are also the basis for drift dives later (§4).
- **Temperature.** Only one temperature value was written for the whole dive (20.0 °C), probably because the Perdix records whole degrees and the water didn't change by a full degree. So the temperature is coarse, and the notes should give it to whole degrees.
- **No compass data** is stored.
- **Start and end of the dive.** The first sample (0:10) is at 0.0 m, and samples continue at 0.0 m for over a minute after surfacing (112:40–114:00). The descent and surface anchors for sync (§8.2) are where the depth first crosses below and last crosses above a threshold (default 1 m), interpolated between samples, not the first and last samples. Using the *last* crossing means a slow finish that hovers near the threshold anchors on the final time the computer comes up past it. Many computers jump straight from ≈1.4 m to 0.0 m between samples, so the surface anchor is only as precise as the sample interval.
- **One dive per file** is expected. If a file contains several dives or several dive computers, the tool asks which to use.

A dive with no GPS fix is still accepted (§9.10).

### 6.3 Settings (saved in browser storage)

- iNat API token (v1).
- Observer name (the diver), shown in notes.
- Capturer name, defaulting to the iNat username.
- Location accuracy, default **150 m**.
- Observation field IDs for depth and water temperature (see §9.4).
- Optional iNat project ID to add observations to.
- Notes free text (e.g. a citation or project statement).

Licences follow the uploader's iNat account defaults (§9.6).

## 7. Frame capture

This is the hardest technical problem, and the approach needs proving with a prototype first.

### 7.1 The constraint

A web page cannot read pixels from an embedded YouTube player. The player is a cross-origin iframe, so the browser blocks access to it. The IFrame API controls playback but doesn't expose frames. Downloading the video is ruled out (§2).

### 7.2 Chosen approach: a small helper extension

The web page remains the app. A small companion browser extension (the "frame grabber") does one job: read frames from the embedded player.

- **Where it runs.** A content script injected only into YouTube embed frames (`youtube.com/embed/*`, `youtube-nocookie.com/embed/*`, `all_frames: true`), and only when the parent page is the tool's own origin (checked with `location.ancestorOrigins`). It does nothing on youtube.com itself or on any other site.
- **How it reads frames.** Inside the player's frame, the script can reach the `<video>` element directly. It draws the current frame to a canvas at the decoded resolution (`videoWidth × videoHeight`; 3840 × 2160 when YouTube is playing 2160p), independent of screen size.
- **Exact frame times.** It reads and sets `video.currentTime` directly and uses `requestVideoFrameCallback` to get each frame's exact media time.
- **Messaging.** The page and extension talk with `postMessage`, restricted to the tool's origin. The page sends commands (`grab`, `burst`, `step`, `status`), and the extension returns frames as transferable `ImageBitmap`s or JPEG blobs, each with its media time.
- **Status.** The page detects whether the extension is present and shows a clear install prompt if not. It also reports the resolution actually being played, and warns if it's below the source (e.g. playing 1080p of a 4K upload). The player keeps its normal controls so the user can choose 2160p in the quality menu.
- **Size.** Roughly 100–200 lines plus a manifest, with no settings, network access or storage of its own.
- **Trusted origins.** `https://notionparallax.github.io` (the hosted site) and `localhost` (development). A custom domain later means a new extension version. No other page can talk to the extension.
- **Browsers.** Chrome only (Manifest V3; Edge also runs it). A Firefox port is mostly the same code if it's wanted later.
- **Distribution.** Soft launch: the site offers the extension as a zip (built from `extension/` by `npm run build`) to load unpacked. Next: published on the Chrome Web Store (one-off developer fee, review). Google bars extensions that download YouTube videos. This one copies frames from a video that's already playing, in the same way as many screenshot extensions already on the store, but the listing should say so plainly.

### 7.3 Burst capture and sharpness ranking

Pressing **mark** captures a short burst around the current moment, not a single frame. Since extension v0.2.0 the burst is **recorded while the video plays**, which is much faster than seeking to each frame:

1. Seek once to just before the window (default −0.5 s to +0.5 s around the mark), mute, and play.
2. On every presented frame inside the window (`requestVideoFrameCallback`), snapshot it immediately (`createImageBitmap`), then carry on playing.
3. Each snapshot is scored for sharpness (variance of the Laplacian) and encoded as a full-resolution JPEG in the background, and **sent to the page as soon as it's ready**. The frame picker opens on the first frame and fills in as the rest arrive; ranks update as they come.
4. When the window ends, pause, return to the marked moment, and pre-select the sharpest frame.

At a 24 fps source, a 1 s window gives ≈24 frames in about a second of playback, plus encoding. A "capture speed" setting (full, half or quarter speed) trades time for catching every frame on slower machines. A single-frame mode (grab exactly the current frame) is also available, and the older seek-per-frame method remains as a fallback for older extension versions.

**GIF frames** use the same recording, but each snapshot is cropped (to the crop box, if chosen) and scaled to the GIF width as it's taken, kept only at the GIF frame rate, and sent as raw pixels, with no JPEG step. A 3 s GIF takes about 3 s to capture.

### 7.4 Frame timestamps

Each frame records its exact media time. This feeds the sync (§8), the YouTube link in the notes (§9.3) and chapter titles (§12).

### 7.5 Alternatives considered

| Approach | Why not chosen |
| --- | --- |
| Server-side download (yt-dlp) | Downloading breaches YouTube's terms and breaks whenever YouTube changes; unsuitable for a published research tool. |
| Tab capture (`getDisplayMedia` + Region Capture) | Needs no install, but resolution is limited to the player's size on screen, player overlays can appear in frames, and frame times are approximate. Kept as a possible no-install fallback. |
| Existing screenshot extensions (e.g. "Video Screenshot") | Save to the downloads folder or clipboard, with no way for another page to drive them, and no frame times or bursts. A clipboard workflow (grab with the extension, paste into the tool) could serve as a stopgap before the helper exists. |
| The extension as the whole app (side panel on youtube.com) | Ruled out by the user: the tool should be a web page. |
| User uploads the original MP4 | Ruled out: no video handling by the tool. |

## 8. Video ↔ dive log sync

### 8.1 Model

Log time *t_log* (seconds since dive start) relates to video time *t_vid* by:

> *t_log* = *a* · *t_vid* + *b*

where *b* is the offset, and *a* is a drift factor, defaulting to 1.

### 8.2 Setting sync

- **Two-point (preferred):** the user clicks the video frame where the descent begins and the frame where they surface. These are matched to the log's descent and surface anchors (§6.2). Two points give both *a* and *b*.
- **One-point:** descent only; *a* = 1.
- **Drag:** if the video starts or ends mid-dive, the user drags the depth profile along the timeline until features line up (e.g. a stop, a sharp descent). What dragging does depends on how many sync points are set:
  - none: it shifts the whole profile (offset *b*, with *a* = 1);
  - one (usually the descent): the profile stays pinned at that point and dragging **stretches** it (changes *a*), to correct clock drift without losing the anchor. Stretch is limited to ±50 %;
  - two: the profile is fixed, and dragging does nothing until sync is reset.

Sync isn't accurate to better than the log's sample interval (≈10 s), which is acceptable for depth and temperature.

### 8.3 Derived values

For an observation at video time *t_vid*:

- **Time:** dive start time + *t_log*.
- **Depth and temperature:** linearly interpolated between the two nearest samples. Notes label them as interpolated.
- **Time zone:** derived from the dive site's GPS position (offline time zone lookup), since Subsurface stores local time without a zone. With no GPS fix, the user's iNat account time zone is used. The user can override it either way.

The tool shows a mismatch warning if the video's span after sync differs from the dive's duration by more than a set threshold.

## 9. Observations

### 9.1 Workflow (modal)

1. Press **N** (new observation). The previous observation must be completed or discarded.
2. Watch, and press **M** to mark. A burst is captured (§7.3) and opens in a **full-screen frame picker**: one frame shown as large as the screen allows, with every captured frame in a strip of thumbnails underneath (sharpness bar under each). Arrow keys or `,`/`.` move between frames; Space selects; `1`–`9` select the sharpest frames of the latest burst; `M` captures another burst without leaving; `Esc` closes. Buttons at either end of the strip capture one more second of frames before the first frame or after the last. Frames are large enough to judge focus and camouflage.
3. Select 1–4 stills from one or more bursts. All marks within one observation are assumed to be **the same organism**. A GIF can also be made from a stretch of video around any frame (§9.7).
4. Optionally click the organism in the large view to record where it is in the frame (§9.8). Clicking an unselected frame selects it and marks the position in one step.
5. Press **C** (complete). The annotation form appears; set values with clicks or keys, or leave them unset.
6. Confirm. The observation uploads in the background and the user carries on watching.

One frame may show several organisms. The same frame can be reused in several observations, and the notes should say which organism each observation is about (iNat's quality criteria expect evidence of a single subject).

iNat convention is one observation per individual per place and time. If the same individual is seen again later in the dive, the user shouldn't make a second observation of it.

### 9.2 Fields sent to iNaturalist

| iNat field | Value |
| --- | --- |
| Taxon | **None.** Identification happens on iNat. |
| Observed on | Dive start + synced log time, with time zone (§8.3) |
| Latitude / longitude | Dive site GPS (entry point). If the log has no GPS fix, left empty for the user to set on iNat (§9.10) |
| Positional accuracy | Setting, default 150 m |
| Geoprivacy | Left to iNat (open by default; iNat obscures threatened taxa automatically) |
| Captive/cultivated | Not set (wild by default) |
| Description | Notes template (§9.3) |
| Observation fields | Depth, water temperature (§9.4) |
| Annotations | As set by the user; all unset by default (§9.5) |
| Photos | Optional GIF first (§9.7), then 1–4 stills as JPEG, then any crops (§9.9) |
| Project | Optional; the target project already collects observations by geofence |
| Licence | §9.6 |

### 9.3 Notes template

```txt
Video: https://youtu.be/<id>?t=<seconds>
Depth: 12.4 m (interpolated from dive computer log)
Water temperature: 18 °C (dive computer)
Dive site: <site name>
Location: dive entry point (dive computer GPS), not the exact position of the organism
Time into dive: 00:23:41
Subject position: photo 1 – 80% across, 20% down (upper right); photo 2 – 48% across, 51% down (centre)
Observed by: <diver>. Frames captured by: <capturer>, with the video owner's permission.
<user free text>
Created with <tool name> v<version>
```

The YouTube link with timestamp is the main motion evidence for identifiers, and stays useful even if iNat stops accepting animated GIFs.

### 9.4 Observation fields

iNat observation fields are created by users, and there are many near-duplicates for depth and water temperature, which differ in name, unit and data type. A search on one field won't find observations that used another, so the choice matters for analysis.

- The scientist chooses the field IDs, preferring widely used number fields in metres and °C.
- Field IDs are settings, not hard-coded.
- Checked against iNat on 2026-11-16. **Depth** has a clear standard: field 558 "Depth (m)", numeric, ≈46,000 uses, which the tool uses by default. **Water temperature** has none: the candidates are 14913 "Water temperature (in °C)" (numeric, ≈1,300 uses) and 1661 "Water temperature (C)" (text, ≈850 uses). Chosen 2026-11-16: field 14913 "Water temperature (in °C)", numeric, used by default.
- Values are always repeated in the notes, in plain text.

### 9.5 Annotations

After **complete**, the form shows every annotation iNat supports, each one **unset** by default, plus the values iNat allows for it:

- Alive or Dead
- Life stage
- Sex
- Evidence of presence
- Flowers and fruits (plants)
- Leaves (plants)

Nothing is assumed, not even Alive. iNat only offers some annotations for certain kinds of organism. Because taxon is unset at upload, the tool offers all of them and drops any that iNat rejects.

From iNat's list of annotations (checked 2026-11-16): Alive or Dead and Life stage apply to animals only; Flowers and fruits to plants; Leaves to vascular plants; Sex and Evidence of presence to all life. iNat doesn't classify red and brown algae as plants, so for most marine algae only the last two apply. The form labels each annotation with the groups it applies to.

### 9.6 Licence

Observations and photos take the **uploader's iNaturalist account defaults** (decided 2026-11-16). The tool doesn't set a licence itself:

- iNat applies the account's default photo licence to uploaded photos, and setting a different licence per photo isn't straightforward through the API. Setting only the observation's licence would leave the observation and its photos licensed differently.
- The permission step shows the account's observation and photo licences, and links to iNat's account settings for changing them.
- The frames come from the diver's video, so the diver owns their copyright. The capturer must confirm the owner agrees to frames being released under the account's photo licence (§15). If the account's licence changes later, the confirmation must be given again.

CC0, CC-BY and CC-BY-NC observations and photos all flow on to GBIF, so any of these suits research use. CC-BY-NC rules out commercial reuse only.

### 9.7 Animated GIFs

Made from the frame picker (`G`), around the frame being viewed:

- The user sets how many seconds before and after the frame (default 1.5 s each, so 3 s), the frame rate (default 10 fps) and the width (default 800 px). Optionally the GIF shows only the frame's crop box area (§9.9), which keeps small subjects visible.
- The extension steps through that stretch of video at the GIF frame rate (§7.3), so these frames are captured separately from the stills.
- Encoded **in the browser** with `gifenc`, using one palette for the whole animation to avoid flicker. If the result is over ≈5 MB (larger GIFs often fail to upload to iNat), the tool reduces colours to 128, then 64, then shrinks the size, until it fits.
- A finished GIF is added to the observation straight away and previewed; making it again replaces it. One GIF per observation, uploaded as the **first** photo, so it becomes the thumbnail. The notes say "Photo 1 is an animated GIF from the video."
- Risk: iNat staff have said animated GIFs were never officially supported and may be removed. The YouTube link in the notes is the fallback. iNat accepts JPEG, PNG and GIF only; WebP and video are not accepted.

### 9.8 Subject position in the frame

Wide-angle frames often contain a small organism among a lot of reef. Context is useful, so frames are not cropped; instead the user can point out where the subject is.

- With a still selected, the user clicks the organism. The tool stores the point as a percentage of the frame's width and height (*x*% across from the left, *y*% down from the top), so it is independent of resolution.
- One point per photo, because the organism moves between frames. Optional; photos without a point are simply not mentioned.
- The notes list each point with a plain-language region (a 3 × 3 grid: upper left … lower right) so identifiers can find the subject quickly (§9.3).
- Especially useful when one frame is reused for several observations (§9.1): the point says which organism this observation is about.
- Photos are uploaded unaltered. A later option could add an extra copy with a ring drawn around the subject, placed **last** so it never becomes the thumbnail.

### 9.9 Crops

iNat stores photos at most 2048 px on the long edge, so a 4K frame loses about half its linear resolution and small subjects lose detail. In the frame picker, the user can add a **crop box** to any selected still, and the crop is uploaded as an extra photo:

- Added with the "Add crop" button or `R`; starts at the smallest allowed size, centred on the subject position if one is marked.
- Dragged to move, and resized from its corner. It keeps the frame's aspect ratio and **can't be smaller than 2048 px on the long edge**, so iNat never has to scale it up and the crop uses every pixel iNat will keep.
- Offered only for frames larger than 2048 px (a 1080p frame already fits).
- One crop per still, optional.
- Photo order: GIF, then the full stills, then the crops. The full frame stays the thumbnail.
- Crops are new images cut from the full-resolution frame, and the notes say which photos are crops ("Photo 4 is a full-resolution crop of photo 2").

### 9.10 Dives with no GPS fix

If the log has no position (transmitter not paired, no surface fix), the tool doesn't try to supply one. It uses iNat's own location tools instead:

- Observations upload with no location, and the user sets it afterwards in iNat's editor (map pin, search, or batch edit).
- The setup screen warns at the start, before any capture, that this dive has no GPS fix.
- After uploading, the tool lists the observations still missing a location, with links to edit them on iNat.
- Until a location is set, the observations can't reach research grade and won't be picked up by geofence-based projects.

## 10. Upload

- Each observation uploads when completed ("upload as you go").
- Request rate is throttled to ≈1 request per second (pyinaturalist's built-in limiter). One observation needs ≈2–6 requests.
- On failure: retry up to 3 times with increasing waits, then stop, show the error, and keep the observation queued for a manual retry.
- On success: save the iNat observation ID against the timeline marker, and link to it.

## 11. Saved state, markers and duplicates

Saved per YouTube video ID in browser storage:

- Sync parameters and the loaded dive log (parsed).
- Observations: marks, chosen frame times, annotations, status (draft, uploading, uploaded, failed), and iNat ID.
- Reviewed ranges: sections of the video that have actually been played.

Captured frame images go in IndexedDB, not `localStorage`, which is limited to ≈5 MB. Images are deleted after a successful upload unless the user downloads them (v1.5).

Build note (v0.1.0): frame images are currently kept in memory only, so a draft observation, or a failed upload awaiting retry, is lost if the page is reloaded. Moving them to IndexedDB is still to do.

On the timeline:

- **Markers** show where observations were captured, coloured by status. Clicking one jumps to it and opens it on iNat.
- **Shading** shows reviewed sections, so a long dive can be worked through over several sittings.

This is the main guard against duplicate uploads. It only works within one browser; sharing state between capturers is out of scope for v1.

## 12. YouTube chapter titles

A few days after uploading, once identifications on iNat have settled, the tool can generate chapter titles for the video, turning it into an indexed record of what was seen.

### 12.1 Process

1. The user opens the video in the tool and chooses **Generate chapters**.
2. The tool fetches the video's observations from iNat. Read-only, so no login is needed. It finds them by the iNat IDs saved in browser storage. If that state is missing (a different browser or person), it falls back to searching iNat for observations whose notes contain the video's link (`youtu.be/<id>`) and reading each one's timestamp from that link. Because the notes carry everything needed, chapters can always be rebuilt from iNat alone.
3. For each observation it takes the first marked moment minus a lead-in (default **2 s**, configurable) and the current community identification.
4. It shows the list for review, with each observation's quality grade, and produces a text block for the video description.

### 12.2 Chapter rules

YouTube only recognises chapters if: the first starts at `0:00`, there are at least three, and each lasts at least 10 seconds. The tool therefore:

- adds a first chapter at `00:00` (default "Descent", editable);
- merges observations closer than 10 s into one chapter ("Old wife / Blue groper");
- warns if there are fewer than three chapters.

### 12.3 Titles

- Default format: common name (scientific name), e.g. `Weedy seadragon (Phyllopteryx taeniolatus)`. Falls back to the scientific name, or to the coarsest rank if not identified to species (e.g. `Nudibranchs (Nudibranchia)`).
- Options: include only research-grade observations; include or omit unidentified ones ("Unidentified – see iNat").
- Each name is followed by its observation's iNat link (`https://inaturalist.org/observations/<id>`; on by default, can be turned off). Same-species observations merged into one chapter list all their links. Links make the block much longer, and a YouTube description holds 5,000 characters in all, so the tool warns past 4,000.

### 12.4 Output

```txt
0:00 Descent
3:12 Sponge garden – Red algae (Rhodophyta)
7:45 Weedy seadragon (Phyllopteryx taeniolatus)
...
```

- v1: copy-to-clipboard text that the video owner pastes into the YouTube description. If the capturer isn't the owner, they send it to the owner.
- Later: write the description directly through the YouTube Data API. This needs the video owner's own Google login, because only the owner can edit a video.

Known limitation: timestamps in notes and chapters assume the video never changes. If the owner trims or replaces it, they'll point to the wrong moment, and the tool doesn't try to detect this.

## 13. Keyboard shortcuts

The complete list, grouped by task, lives in `frontend/src/lib/shortcuts.js`. It feeds both the Shortcuts panel and a printable A4 card (`shortcuts.html`), so they stay in step. The table below is the summary.

The page re-implements YouTube's standard shortcuts (keys pressed inside the iframe go to YouTube, so focus is kept on the page), and adds its own. Playback commands go through the IFrame API; frame stepping goes through the extension, which can seek exactly.

| Key                         | Action                                                      |
|-----------------------------|-------------------------------------------------------------|
| Space / K                   | Play / pause                                                |
| J / L                       | Back / forward 10 s                                         |
| ← / →                       | Back / forward 5 s                                          |
| , / .                       | Back / forward one frame (when paused, exact via extension) |
| < / >                       | Slower / faster playback                                    |
| 0–9                         | Jump to 0–90 %                                              |
| **N**                       | New observation                                             |
| **M**                       | Mark (burst capture)                                        |
| **Shift+M**                 | Single-frame capture                                        |
| 1–4 (in filmstrip)          | Toggle selection of a highlighted frame                     |
| Click (on a selected still) | Set subject position (§9.8)                                 |
| **C**                       | Complete observation → annotation form                      |
| Enter                       | Confirm and upload                                          |
| Esc                         | Cancel the current step / discard draft (with confirmation) |
| D / S                       | Set descent / surface sync point at the current frame       |

## 14. Interface layout

```txt
┌──────────────────────────────────────────────┬──────────────────────┐
│                                              │  Observation #7       │
│              YouTube player                  │  [filmstrip of burst] │
│                                              │  ★ sharpest frames    │
│                                              │  Selected: 3/4        │
├──────────────────────────────────────────────┤  [Complete]           │
│  timeline: ▮reviewed ▮  ● ● ●  (markers)     ├──────────────────────┤
│  depth profile  ╲__/‾‾╲____/‾‾‾╲___╱         │  Dive: Site, date     │
│  sync: descent ▲       surface ▲              │  Depth 12.4 m 18 °C   │
└──────────────────────────────────────────────┴──────────────────────┘
```

A setup screen before work begins covers: video URL, log file, sync, token check, extension check, and the permission checkbox. It hides itself once the video, dive log and permission are all in place, leaving a row of status chips; the Setup button reopens it.

Build note (v0.1.x): during development, `frontend/src/lib/devDefaults.js` fills in the sample video, dive log, permission and observer name automatically. It's temporary and switched off by setting `enabled: false`.

## 15. Permission and credit

- Before the first upload for a video, the capturer must tick: *"I have explicit permission from the owner of this video to create iNaturalist observations from it, and to release its frames under <account photo licence>."* The confirmation and the licence it covered are saved per video ID; if the account's photo licence changes, the box must be ticked again.
- If the capturer is the owner, the same step applies; it simply records their own choice.
- Notes always credit the observer (diver) and the capturer separately (§9.3).
- The observation is uploaded under the capturer's account, as iNat requires.

## 16. Authentication

- **v1:** the user pastes an iNat API token (from `inaturalist.org/users/api_token`). Tokens expire after 24 hours; the tool detects expiry and prompts for a new one.
- **v2:** OAuth with PKCE, using an iNat application registered under the author's account (iNat requires an established account to register an app).

## 17. Technology

| Part             | Choice                                      |
|------------------|---------------------------------------------|
| Front end        | Svelte (SvelteKit or Vite)                  |
| Frame grabber    | Browser extension, Manifest V3, plain JS/TS |
| Back end         | None: static files on GitHub Pages          |
| iNat client      | `fetch`, in the browser                     |
| Log parsing      | `DOMParser`, in the browser                 |
| Time zone lookup | `@photostructure/tz-lookup` (offline)       |
| Sharpness        | Variance of the Laplacian (OpenCV or NumPy) |
| GIF              | gifenc, in the browser                      |
| Licence          | MIT                                         |

## 18. Open questions and things to verify

1. **Frame grabber test in a real browser** (highest priority): confirm the content script can draw the `<video>` to a canvas at 2160p, and that frame-by-frame seeking for bursts is fast and exact enough. The page-to-extension handshake works. Automated browsers can't test the rest, because YouTube shows them a "confirm you're not a bot" screen, so this needs a person in their own signed-in Chrome.
2. (Resolved: water temperature uses field 14913, depth uses 558; see §9.4.)
3. Whether the Perdix can be set to a faster sample rate than 10 s and whether Subsurface keeps it.
4. Storing captured frames in IndexedDB so a reload doesn't lose a draft or a failed upload (§11). Deferred for now.
5. Whether a "head-mounted camera" note is useful to the scientist.
6. How YouTube plays a 24 fps source (whether it keeps 24 fps). The extension estimates the frame rate during playback.
7. Why the sample video (`MRja6VhCmMs`) ends ≈2 minutes before the dive does (e.g. the camera stopping, or a missing final GoPro file chapter). Two-point sync isn't possible for it, so it's the test case for one-point sync plus dragging the profile (§8.2).

## 18a. Decisions log

Resolved questions, kept here so the reasoning isn't lost:

| Question | Decision |
| --- | --- |
| How a capturer who isn't the diver gets the dive log | The diver sends them the `.ssrf` file. The tool doesn't handle this. |
| EXIF metadata in uploaded photos | Not embedded. iNat strips EXIF from stored image files (it shows it on the photo page instead), so it wouldn't survive a later download. Embedded GPS would also be shown on the photo page even when iNat obscures the observation's location for a sensitive species. Date, time and location go through the API fields only. Downloaded frame bundles (v1.5) may carry EXIF, since they stay with the user. |
| Videos trimmed or replaced after upload | Accepted as a known limitation. Links and chapters will point to the wrong moment, and the tool won't try to detect it. |
| Origins the extension trusts | `notionparallax.github.io` for the hosted site, plus `localhost` for development. |
| Back end | None. Everything runs in the browser and the site is hosted as static files (§5). Decided 2026-11-18 for the soft launch. |
| Browsers | Chrome (and Edge, which runs Chrome extensions) only for now. |
| Observation fields | Depth: 558 "Depth (m)". Water temperature: 14913 "Water temperature (in °C)". Both numeric (§9.4). |
| Paper | About the data, not the tool (§19). |
| Licences | Follow the uploader's iNat account defaults, since photos take the account default anyway; CC-BY-NC is fine for research and GBIF (§9.6). Replaces the earlier per-video licence choice. |
| Duplicates across capturers | Deferred (§4, Later). |
| No GPS fix | Upload without a location; set it on iNat (§9.10). |
| Which GPS position | The transmitter GPS recorded by the dive computer (`Start location`), falling back to the Subsurface dive site position. |
| Maximum photo size on iNat | 2048 px on the long edge (seen in photos' original dimensions), so crops are never smaller than that (§9.9). |
| First real upload (observation 415038559) | iNat accepted: annotations with no taxon; licence code `CC0` on the observation; time zone as an IANA name (`Australia/Sydney`), with the observation time correct; depth in field 558. Photos were stored at 2048 × 1152, so frames were captured at more than 2048 px wide. Photo licences did not follow the video's licence (§18 item 4). |
| Finding a video's observations on iNat | Searching observation descriptions for the video ID works (`q=<id>&search_on=description`). |
| Non-divers / no dive log | No-log mode in v2 (§4). |

## 19. Data quality (for the paper)

The paper will be about the data, so what matters is that observations are consistent and analysable, not measurements of the tool itself:

- Every observation uses the same observation fields, units and notes format (§9.3, §9.4), so the scientist can query them reliably.
- Derived values are labelled as derived, with the method stated (interpolation, entry-point location, 150 m accuracy), so they can be described in the paper's methods.
- The tool is versioned, and its version is included in the notes, so the methods can cite exactly how observations were produced.

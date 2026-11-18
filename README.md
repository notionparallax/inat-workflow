# Dive iNat

Turn a dive video on YouTube plus a Subsurface dive log into iNaturalist observations. Watch the video, press
**M** when you see something, pick sharp frames, and upload. Time, depth, temperature and location come from the
dive log; identification happens afterwards on iNaturalist. See [SPEC.md](SPEC.md) for the full specification.

It's a static website with no back end: the dive log is read, and observations are built, in your browser, which
talks to iNaturalist directly. A small Chrome extension reads frames from the embedded YouTube player.

**Use it:** <https://notionparallax.github.io/inat-workflow/>. The first visit explains how to install the extension.

## Development

You need Node 20+ and Chrome.

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173
npm test         # parser, sync, notes, chapters, iNat client
npm run build    # static site in frontend/dist, including the extension zip
```

In development the tool starts with a sample video and dive (`src/lib/devDefaults.js`; never in the built site).

**Extension:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the
`extension` folder. It only runs inside the YouTube player embedded on the hosted site or on `localhost`.

**Deploying:** every push to `main` builds and publishes the site to GitHub Pages
(`.github/workflows/pages.yml`). In the repository's Settings → Pages, set the source to **GitHub Actions**.

**Chrome Web Store:** upload `frontend/dist/dive-inat-extension.zip` (made by `npm run build`). Icons are in
`extension/icons/`, store tiles in `store/`, and the privacy policy is the site's `privacy.html`. Graphics are made by
`scripts/render-graphics.mjs`. The listing is
[Dive iNat frame grabber](https://chromewebstore.google.com/detail/dive-inat-frame-grabber/nlecoipnfjnedajcjdlagpolhaehjcdl);
its link is `EXTENSION_STORE_URL` in `frontend/src/lib/config.js`. For an update, bump the version in
`extension/manifest.json` and `extension/grabber.js`, build, and upload the new zip.

## Using it

1. **Setup → Video:** paste the YouTube link.
2. **Setup → Dive log:** choose the `.ssrf` file exported from Subsurface.
3. **Setup → iNaturalist login:** paste a token from <https://www.inaturalist.org/users/api_token>. Tokens last
   24 hours and are kept only in your browser.
4. **Sync:** pause where you go under and press **D**; where you surface, press **S**. If the video starts or ends
   mid-dive, set one point and drag the depth profile sideways until it lines up.
5. **Permission:** tick the box to confirm the video owner agrees to the licence your iNat account uses for photos.
6. **Settings:** observer name, observation fields, and so on. **Dry run is on by default**: uploads only show
   what would be sent. Turn it off in Settings when you're ready for real uploads.

Then watch: **M** captures a burst of frames around the moment and opens them full-screen; arrow keys move between frames, **Space** or **1–9** selects up to four stills, and
clicking the organism marks where it is, **R** adds a crop box (uploaded as an extra photo), and **G** makes an animated GIF around the current frame (uploaded first). **C** goes to
annotations, **Enter** uploads. The **Shortcuts** button lists every key.

## Scripts

`scripts/` has Playwright scripts (`npm install` there first):

- `smoke-ui.mjs` loads the app with the sample dive and takes screenshots (needs `npm run dev` running).
- `test-grabber.mjs` tries the extension against a real video. YouTube currently shows automated browsers a
  “confirm you're not a bot” screen, so the real extension test has to be done by hand in your own Chrome.
- `render-graphics.mjs` renders the favicon, extension icons, store tiles and link-preview image.
- `store-screenshot.mjs` takes a 1280×800 main-view screenshot for the store (needs `npm run dev` running).

## Layout

| Folder | What |
| --- | --- |
| `frontend/src/lib/` | `ssrf.js` log parser · `dive.js` sync and interpolation · `notes.js` notes template · `chapters.js` YouTube chapters · `inat.js` iNat client · `api.js` the operations the app calls |
| `frontend/src/` | Svelte app: player, timeline and depth profile, observation workflow, setup, settings, chapters, intro |
| `extension/` | Frame grabber (Manifest V3 content script) |
| `store/` | Chrome Web Store tiles |
| `scripts/` | Playwright scripts |

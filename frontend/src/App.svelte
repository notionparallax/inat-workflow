<script>
  import { onDestroy, onMount } from "svelte";
  import Timeline from "./components/Timeline.svelte";
  import ObservationPanel from "./components/ObservationPanel.svelte";
  import SetupPanel from "./components/SetupPanel.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import ChaptersPanel from "./components/ChaptersPanel.svelte";
  import FramePicker from "./components/FramePicker.svelte";
  import { DEV_DEFAULTS } from "./lib/devDefaults.js";
  import { api } from "./lib/api.js";
  import { createGrabber } from "./lib/grabber.js";
  import { loadYouTubeApi, PLAYER_ERRORS } from "./lib/youtube.js";
  import { addRange, clock, dragSync, interpolate, syncFrom, videoIdFrom, videoToLog } from "./lib/dive.js";
  import { canCrop, cropFromBox, defaultCropBox } from "./lib/frames.js";
  import { loadLastVideo, loadSettings, loadVideoState, saveLastVideo, saveSettings, saveVideoState } from "./lib/store.svelte.js";

  const MAX_STILLS = 4;

  let settings = $state(loadSettings());
  let video = $state(null);
  let videoInput = $state("");
  let me = $state(null);
  let meError = $state(null);
  let terms = $state([]);
  let playerError = $state(null);
  let currentTime = $state(0);
  let duration = $state(0);
  let playing = $state(false);
  let extension = $state({ found: false, version: null, width: null, height: null, fps: null, qualityNote: null });
  let draft = $state(null);
  let stage = $state("idle"); // idle | capturing | annotating
  let busy = $state(false);
  let panel = $state("setup"); // setup | settings | chapters | help | null
  let toast = $state(null);
  let diveChoices = $state([]);
  let pickerOpen = $state(false);
  let pickerHighlight = $state(null);

  let player = null;
  let lastPollT = null;
  let saveTimer = null;
  let toastTimer = null;
  const pendingUploads = new Map(); // record id → { meta, photos } kept in memory for retries
  let frameSeq = 0;

  const sync = $derived(video ? syncFrom(video.sync, video.dive) : { a: 1, b: 0 });
  const tLog = $derived(videoToLog(currentTime, sync));
  const live = $derived.by(() => {
    const samples = video?.dive?.samples;
    if (!samples) return null;
    return { depth: interpolate(samples, tLog, "depth"), temp: interpolate(samples, tLog, "temp") };
  });
  const drift = $derived(video?.sync.descentVid != null && video?.sync.ascentVid != null ? (sync.a - 1) * 100 : null);
  const missingLocation = $derived(video ? video.observations.filter((o) => o.status === "uploaded" && o.has_location === false) : []);
  const recent = $derived(video ? [...video.observations].reverse() : []);
  const setupComplete = $derived(!!(video?.dive && video?.permission.granted));
  const anchorCount = $derived(video ? [video.sync.descentVid, video.sync.ascentVid].filter((v) => v != null).length : 0);

  // Hide the setup panels once everything they ask for is done.
  let wasComplete = false;
  $effect(() => {
    if (setupComplete && !wasComplete && panel === "setup") panel = null;
    wasComplete = setupComplete;
  });

  const grabber = createGrabber({
    getIframe: () => player?.getIframe?.(),
    onHello: (version) => { extension.found = true; extension.version = version; },
    onKey: (d) => handleKey(d.key, d.shiftKey),
  });
  extension.requestQuality = async () => {
    try {
      const r = await grabber.quality("hd2160");
      extension.qualityNote = r.ok ? `Asked for ${r.set}. Available: ${r.available.join(", ")}` : `Couldn't set quality: ${r.error || "no levels reported"}`;
    } catch (e) {
      extension.qualityNote = e.message;
    }
  };

  function say(message, kind = "info") {
    toast = { message, kind };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), kind === "error" ? 9000 : 4000);
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => video && saveVideoState($state.snapshot(video)), 600);
  }

  function updateSettings(next) {
    settings = next;
    saveSettings($state.snapshot(settings));
  }

  // --- Video and player ----------------------------------------------------------
  async function loadVideo(input) {
    const id = videoIdFrom(input);
    if (!id) return say("That doesn't look like a YouTube link or video ID.", "error");
    if (draft) discard(true);
    video = loadVideoState(id);
    videoInput = `https://youtu.be/${id}`;
    saveLastVideo(id);
    playerError = null;
    extension.found = false;
    const YT = await loadYouTubeApi();
    if (player) player.destroy();
    player = new YT.Player("yt-player", {
      videoId: id,
      playerVars: { controls: 1, rel: 0, playsinline: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => { duration = player.getDuration() || 0; grabber.ping().then((r) => { extension.found = true; extension.version = r.version; }).catch(() => {}); },
        onError: (e) => { playerError = PLAYER_ERRORS[e.data] || `YouTube player error ${e.data}`; },
        onStateChange: (e) => { playing = e.data === YT.PlayerState.PLAYING; if (!duration) duration = player.getDuration() || 0; },
      },
    });
  }

  function poll() {
    if (!player?.getCurrentTime) return;
    const t = player.getCurrentTime();
    currentTime = t;
    if (!duration) duration = player.getDuration?.() || 0;
    if (playing && video) {
      if (lastPollT != null && t >= lastPollT && t - lastPollT < 2) {
        video.reviewed = addRange(video.reviewed, lastPollT, t);
        persist();
      }
      lastPollT = t;
    } else {
      lastPollT = null;
    }
  }

  async function pollExtension() {
    if (!extension.found) return;
    try {
      const s = await grabber.status();
      if (s.videoFound) Object.assign(extension, { width: s.videoWidth, height: s.videoHeight, fps: s.fps });
    } catch { /* ignore */ }
  }

  function seek(t) {
    if (!player?.seekTo) return;
    const target = Math.max(0, Math.min(duration || t, t));
    player.seekTo(target, true);
    currentTime = target;
  }

  function togglePlay() {
    if (!player) return;
    playing ? player.pauseVideo() : player.playVideo();
  }

  async function stepFrame(n) {
    if (!extension.found) return say("Frame stepping needs the extension.", "error");
    player.pauseVideo();
    try {
      const r = await grabber.step(n, extension.fps || undefined);
      currentTime = r.time;
    } catch (e) { say(e.message, "error"); }
  }

  function changeRate(dir) {
    const rates = player?.getAvailablePlaybackRates?.() || [0.25, 0.5, 1, 1.5, 2];
    const i = rates.indexOf(player.getPlaybackRate());
    const next = rates[Math.max(0, Math.min(rates.length - 1, i + dir))];
    player.setPlaybackRate(next);
    say(`Playback speed ${next}×`);
  }

  // --- Dive log and sync --------------------------------------------------------------
  async function onDiveFile(file) {
    if (!video) return say("Load the video first.", "error");
    try {
      const { dives } = await api.parseDive(file);
      if (dives.length === 1) setDive(dives[0]);
      else diveChoices = dives;
    } catch (e) { say(e.message, "error"); }
  }
  function setDive(d) {
    video.dive = d;
    video.sync = { descentVid: null, ascentVid: null, dragOffset: 0 };
    diveChoices = [];
    persist();
    if (!d.location) say("This dive has no GPS fix. Observations will upload without a location.", "error");
  }
  function setAnchor(which) {
    if (!video?.dive) return say("Load a dive log first.", "error");
    video.sync[`${which}Vid`] = player?.getCurrentTime?.() ?? currentTime;
    video.sync.dragOffset = 0;
    video.sync.scale = 1;
    persist();
    say(`${which === "descent" ? "Descent" : "Ascent"} set at ${clock(video.sync[`${which}Vid`])}.`);
  }
  let dragWarned = false;
  function onDrag(fromT, toT) {
    if (!video?.dive) return;
    const patch = dragSync(video.sync, video.dive, fromT, toT);
    if (!patch) {
      if (anchorCount === 2 && !dragWarned) { say("Both sync points are set, so the profile is fixed. Reset sync in Setup to drag it."); dragWarned = true; }
      return;
    }
    Object.assign(video.sync, patch);
    persist();
  }

  // --- Observations ------------------------------------------------------------------
  function ensureDraft() {
    if (draft) return;
    const n = Math.max(0, ...(video?.observations || []).map((o) => o.n)) + 1;
    draft = { n, frames: [], annotations: {}, nextBurst: 1 };
    stage = "capturing";
  }

  function addFrames(frames, burstNo) {
    const ranked = [...frames].sort((a, b) => b.sharpness - a.sharpness);
    const entries = frames.map((f) => ({
      id: ++frameSeq, burst: burstNo, time: f.time, width: f.width, height: f.height, sharpness: f.sharpness,
      blob: f.blob, url: URL.createObjectURL(f.blob), rank: ranked.indexOf(f) + 1, selected: false, position: null, cropBox: null,
    }));
    draft.frames.push(...entries);
    const selectedCount = draft.frames.filter((f) => f.selected).length;
    if (selectedCount < MAX_STILLS && entries.length) {
      const best = draft.frames.find((f) => f.burst === burstNo && f.rank === 1);
      best.selected = true;
    }
  }

  async function mark(single = false) {
    if (!video) return say("Load a video first.", "error");
    if (!extension.found) return say("Capturing frames needs the frame grabber extension (see Setup).", "error");
    if (busy) return;
    if (stage === "annotating") stage = "capturing";
    ensureDraft();
    busy = true;
    const burstNo = draft.nextBurst++;
    try {
      if (single) {
        const f = await grabber.grab();
        addFrames([f], burstNo);
      } else {
        const center = player.getCurrentTime();
        const r = await grabber.burst({ center, before: settings.burst_before, after: settings.burst_after, fps: extension.fps || undefined });
        if (!r.frames.length) throw new Error("No frames came back from the player.");
        addFrames(r.frames, burstNo);
      }
      openPicker(draft.frames.find((f) => f.burst === burstNo && f.rank === 1)?.id);
    } catch (e) {
      say(e.message, "error");
    } finally {
      busy = false;
    }
  }

  function toggleFrame(frame) {
    if (frame.selected) frame.selected = false;
    else if (draft.frames.filter((f) => f.selected).length >= MAX_STILLS) say(`Up to ${MAX_STILLS} stills per observation.`);
    else frame.selected = true;
  }
  function toggleRank(rank) {
    const latest = Math.max(...draft.frames.map((f) => f.burst));
    const frame = draft.frames.find((f) => f.burst === latest && f.rank === rank);
    if (frame) toggleFrame(frame);
  }

  function openPicker(id) {
    if (!draft?.frames.length) return;
    pickerHighlight = id ?? draft.frames.find((f) => f.selected)?.id ?? draft.frames[0].id;
    pickerOpen = true;
  }
  function pickerOrder() {
    return [...draft.frames].sort((a, b) => a.burst - b.burst || a.time - b.time);
  }
  function movePicker(step) {
    const order = pickerOrder();
    const i = order.findIndex((f) => f.id === pickerHighlight);
    pickerHighlight = order[Math.max(0, Math.min(order.length - 1, i + step))].id;
  }
  function pickerKey(key) {
    const order = draft ? pickerOrder() : [];
    const current = order.find((f) => f.id === pickerHighlight);
    switch (key) {
      case "ArrowLeft": case ",": return movePicker(-1);
      case "ArrowRight": case ".": return movePicker(1);
      case " ": case "x": return current && toggleFrame(current);
      case "Enter": case "Escape": pickerOpen = false; return;
      case "c": pickerOpen = false; return complete();
      case "m": pickerOpen = false; return say("Play on, and press M again to add frames from later in the video.");
      case "r":
        if (current?.selected && canCrop(current)) current.cropBox = current.cropBox ? null : defaultCropBox(current);
        return;
    }
    if (/^[1-9]$/.test(key)) {
      const latest = Math.max(...order.map((f) => f.burst));
      const f = order.find((x) => x.burst === latest && x.rank === Number(key));
      if (f) { pickerHighlight = f.id; toggleFrame(f); }
    }
  }

  function complete() {
    if (!draft) return;
    if (!draft.frames.some((f) => f.selected)) return say("Select at least one still first.", "error");
    stage = "annotating";
  }

  function discard(silent = false) {
    if (!draft) return;
    if (!silent && !confirm(`Discard observation ${draft.n}?`)) return;
    draft.frames.forEach((f) => URL.revokeObjectURL(f.url));
    draft = null;
    stage = "idle";
    pickerOpen = false;
  }

  async function upload() {
    if (!draft || busy) return;
    if (!video.permission.granted) {
      panel = "setup";
      return say("Confirm you have the video owner's permission (Setup, step 5) before uploading.", "error");
    }
    busy = true;
    try {
      const stills = draft.frames.filter((f) => f.selected).sort((a, b) => a.time - b.time);
      const photos = stills.map((f, i) => ({ blob: f.blob, filename: `still-${i + 1}.jpg` }));
      const crop_of = [];
      for (const [i, f] of stills.entries()) {
        if (!f.cropBox) continue;
        photos.push({ blob: await cropFromBox(f, f.cropBox), filename: `crop-${i + 1}.jpg` });
        crop_of.push(i);
      }
      const t_vid = stills[0].time;
      const annotations = Object.entries(draft.annotations)
        .filter(([, v]) => v)
        .map(([attribute_id, value_id]) => ({ attribute_id: Number(attribute_id), value_id }));
      const meta = {
        video_id: video.videoId, t_vid, t_log: videoToLog(t_vid, sync), dive: $state.snapshot(video.dive),
        settings: { ...$state.snapshot(settings), capturer: settings.capturer || me?.login || "" },
        licence: video.permission.licence, permission: true,
        positions: stills.map((f) => (f.position ? { x: f.position.x, y: f.position.y } : null)),
        crop_of, has_gif: false, annotations, dry_run: settings.dry_run,
      };
      const record = {
        id: crypto.randomUUID(), n: draft.n, t_vid, t_log: meta.t_log, status: "uploading",
        frames: stills.map((f) => ({ time: f.time, position: f.position ? { ...f.position } : null, cropBox: f.cropBox ? { ...f.cropBox } : null })),
        annotations, created: new Date().toISOString(),
      };
      video.observations.push(record);
      pendingUploads.set(record.id, { meta, photos });
      draft.frames.forEach((f) => URL.revokeObjectURL(f.url));
      draft = null;
      stage = "idle";
      persist();
      send(record.id);
    } catch (e) {
      say(e.message, "error");
    } finally {
      busy = false;
    }
  }

  async function send(id, forceReal = false) {
    const rec = video.observations.find((o) => o.id === id);
    const pending = pendingUploads.get(id);
    if (!rec || !pending) return say("The frames for this observation are no longer in memory (the page was reloaded).", "error");
    const meta = { ...pending.meta, resume: rec.progress || null, dry_run: forceReal ? false : pending.meta.dry_run };
    rec.status = "uploading";
    rec.error = null;
    try {
      const res = await api.upload(meta, pending.photos);
      if (res.dry_run) {
        rec.status = "dry-run";
        rec.preview = { payload: res.payload, photos: res.photos, annotations: res.annotations };
      } else {
        Object.assign(rec, { status: "uploaded", inat_id: res.observation_id, url: res.url, has_location: res.has_location,
                             dropped: res.progress?.dropped_annotations || [], progress: res.progress, preview: null });
        pendingUploads.delete(id);
        say(`Observation ${rec.n} uploaded.`);
      }
    } catch (e) {
      rec.status = "failed";
      rec.error = e.message + (e.body?.body ? ` — ${JSON.stringify(e.body.body).slice(0, 300)}` : "");
      rec.progress = e.body?.progress || rec.progress || null;
      say(`Observation ${rec.n} didn't upload: ${e.message}`, "error");
    }
    persist();
  }

  // --- Keyboard (SPEC §13) --------------------------------------------------------------
  function handleKey(key, shift) {
    if (key.length === 1 && !["<", ">"].includes(key)) key = key.toLowerCase();
    if (pickerOpen && draft) return pickerKey(key);
    if (stage === "annotating") {
      if (key === "Enter") return upload();
      if (key === "Escape") { stage = "capturing"; return; }
    }
    switch (key) {
      case " ": case "k": return togglePlay();
      case "j": return seek(currentTime - 10);
      case "l": return seek(currentTime + 10);
      case "ArrowLeft": return seek(currentTime - 5);
      case "ArrowRight": return seek(currentTime + 5);
      case ",": return stepFrame(-1);
      case ".": return stepFrame(1);
      case "<": return changeRate(-1);
      case ">": return changeRate(1);
      case "n": if (!video) return; if (draft) return say(`Finish or discard observation ${draft.n} first.`); return ensureDraft();
      case "m": return mark(shift);
      case "c": return complete();
      case "d": return setAnchor("descent");
      case "a": return setAnchor("ascent");
      case "Escape": return draft ? discard() : undefined;
    }
    if (/^[0-9]$/.test(key)) {
      if (draft && stage === "capturing") { if (key !== "0") toggleRank(Number(key)); }
      else if (duration) seek((Number(key) / 10) * duration);
    }
  }

  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const handled = [" ", "k", "j", "l", "x", "r", "ArrowLeft", "ArrowRight", ",", ".", "<", ">", "n", "m", "c", "d", "a", "Escape", "Enter",
                     "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const key = e.key.length === 1 && !["<", ">"].includes(e.key) ? e.key.toLowerCase() : e.key;
    if (!handled.includes(key)) return;
    if (key === "Enter" && stage !== "annotating" && !pickerOpen) return;
    if ((key === "x" || key === "r") && !pickerOpen) return;
    e.preventDefault();
    handleKey(e.key, e.shiftKey);
  }

  // --- Start-up ------------------------------------------------------------------------
  let pollTimer, extTimer;
  onMount(async () => {
    pollTimer = setInterval(poll, 250);
    extTimer = setInterval(pollExtension, 2000);
    api.me().then((m) => (me = m)).catch((e) => (meError = e.status === 401 ? "No valid token yet." : e.message));
    api.terms().then((r) => (terms = r.terms)).catch(() => {});
    const last = loadLastVideo();
    if (last) await loadVideo(last);
    if (DEV_DEFAULTS.enabled) await applyDevDefaults();
    if (setupComplete) panel = null;
  });
  onDestroy(() => { clearInterval(pollTimer); clearInterval(extTimer); grabber.destroy(); });

  // Development only: synthetic bursts, for testing the picker without YouTube.
  if (import.meta.env.DEV) {
    window.__diveInat = {
      async fakeBurst(count = 24) {
        ensureDraft();
        const burstNo = draft.nextBurst++;
        const frames = [];
        for (let i = 0; i < count; i++) {
          const c = new OffscreenCanvas(3840, 2160);
          const ctx = c.getContext("2d");
          ctx.fillStyle = `hsl(${180 + i * 3}, 45%, 35%)`;
          ctx.fillRect(0, 0, 3840, 2160);
          ctx.filter = `blur(${Math.abs(i - count / 2)}px)`;
          ctx.fillStyle = "#f5d76e";
          ctx.beginPath(); ctx.ellipse(1400 + i * 40, 1080, 320, 140, 0, 0, Math.PI * 2); ctx.fill();
          ctx.filter = "none";
          ctx.fillStyle = "#fff"; ctx.font = "128px sans-serif"; ctx.fillText(`test frame ${i + 1}`, 120, 240);
          frames.push({ time: currentTime + i / 24, width: 3840, height: 2160, sharpness: 100 - Math.abs(i - count / 2) * 4,
                        blob: await c.convertToBlob({ type: "image/jpeg", quality: 0.8 }) });
        }
        addFrames(frames, burstNo);
        openPicker(draft.frames.find((f) => f.burst === burstNo && f.rank === 1)?.id);
      },
    };
  }

  // TEMPORARY: fill in hard-coded values during development (lib/devDefaults.js).
  async function applyDevDefaults() {
    for (const [k, v] of Object.entries(DEV_DEFAULTS.settings)) if (!settings[k]) settings[k] = v;
    saveSettings($state.snapshot(settings));
    if (!video) await loadVideo(DEV_DEFAULTS.videoUrl);
    if (!video.dive) {
      try {
        const blob = await (await fetch(DEV_DEFAULTS.diveFile)).blob();
        const { dives } = await api.parseDive(new File([blob], "dive.ssrf"));
        setDive(dives[0]);
      } catch (e) { say(`Couldn't load the default dive: ${e.message}`, "error"); }
    }
    if (!video.permission.granted) video.permission = { ...DEV_DEFAULTS.permission };
    persist();
  }

  async function onToken(token) {
    try {
      me = await api.setToken(token);
      meError = null;
      say(`Logged in as ${me.login}.`);
    } catch (e) {
      me = null;
      meError = e.status === 401 ? "That token was rejected or has expired." : e.message;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<header class="top">
  <h1>Dive iNat</h1>
  <div class="chips">
    <span class="chip" class:ok={extension.found}>{extension.found ? "Extension ✓" : "No extension"}</span>
    <span class="chip" class:ok={me}>{me ? `iNat: ${me.login}` : "Not logged in"}</span>
    <span class="chip" class:ok={video?.dive}>{video?.dive ? `Dive #${video.dive.number ?? "?"}` : "No dive log"}</span>
    <span class="chip" class:ok={video?.permission.granted}>{video?.permission.granted ? `Permission ✓ ${video.permission.licence}` : "No permission"}</span>
    {#if settings.dry_run}<span class="chip dry">Dry run</span>{/if}
  </div>
  <nav>
    {#each [["setup", "Setup"], ["settings", "Settings"], ["chapters", "Chapters"], ["help", "Shortcuts"]] as [key, label]}
      <button class:active={panel === key} onclick={() => (panel = panel === key ? null : key)}>{label}</button>
    {/each}
  </nav>
</header>

{#if panel}
  <div class="drawer">
    {#if panel === "setup"}
      <SetupPanel {video} bind:videoInput {me} {meError} {extension} {playing} {diveChoices}
                  onVideo={loadVideo} {onDiveFile} {onToken} onPickDive={(i) => setDive(diveChoices[i])}
                  onPermission={(v) => { video.permission.granted = v; persist(); }}
                  onLicence={(l) => { video.permission.licence = l; persist(); }}
                  onClearSync={() => { video.sync = { descentVid: null, ascentVid: null, dragOffset: 0 }; persist(); }} />
    {:else if panel === "settings"}
      <SettingsPanel {settings} onChange={updateSettings} />
    {:else if panel === "chapters"}
      {#if video}<ChaptersPanel {video} {settings} {me} />{:else}<p>Load a video first.</p>{/if}
    {:else if panel === "help"}
      <table class="keys">
        <tbody>
          <tr><td><kbd>Space</kbd> / <kbd>K</kbd></td><td>Play / pause</td><td><kbd>N</kbd></td><td>New observation</td></tr>
          <tr><td><kbd>J</kbd> / <kbd>L</kbd></td><td>Back / forward 10 s</td><td><kbd>M</kbd></td><td>Mark: capture a burst of frames</td></tr>
          <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>Back / forward 5 s</td><td><kbd>Shift</kbd>+<kbd>M</kbd></td><td>Capture the current frame only</td></tr>
          <tr><td><kbd>,</kbd> / <kbd>.</kbd></td><td>Back / forward one frame</td><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Select the numbered frames (while capturing)</td></tr>
          <tr><td><kbd>&lt;</kbd> / <kbd>&gt;</kbd></td><td>Slower / faster</td><td><kbd>C</kbd></td><td>Complete → annotations</td></tr>
          <tr><td><kbd>0</kbd>–<kbd>9</kbd></td><td>Jump to 0–90 % (when not capturing)</td><td><kbd>Enter</kbd></td><td>Upload (from annotations)</td></tr>
          <tr><td><kbd>D</kbd> / <kbd>A</kbd></td><td>Set descent / ascent sync point</td><td><kbd>Esc</kbd></td><td>Back / discard</td></tr>
        </tbody>
      </table>
      <p class="muted">Shortcuts also work while the player has focus, if the extension is installed.</p>
    {/if}
  </div>
{/if}

<main>
  <div class="left">
    <div class="player-wrap">
      <div id="yt-player"></div>
      {#if !video}<div class="placeholder">Load a YouTube video in Setup to begin.</div>{/if}
    </div>
    {#if playerError}<p class="error-box">{playerError}</p>{/if}
    <div class="nowbar">
      <span><strong>{clock(currentTime)}</strong> video</span>
      {#if video?.dive}
        <span>{clock(tLog)} into dive</span>
        <span>{live?.depth != null ? `${live.depth.toFixed(1)} m` : "outside dive log"}</span>
        {#if live?.temp != null}<span>{Math.round(live.temp)} °C</span>{/if}
        {#if drift != null && Math.abs(drift) > 1}<span class="warn">clock drift {drift.toFixed(1)} %: check sync points</span>{/if}
      {/if}
      {#if draft && !pickerOpen}<span class="open-obs">Observation {draft.n} open: <kbd>M</kbd> adds frames · <kbd>C</kbd> completes</span>{/if}
      <span class="spacer"></span>
      <button onclick={() => mark(false)} disabled={busy || !video}>Mark <kbd>M</kbd></button>
      <button onclick={() => setAnchor("descent")} disabled={!video?.dive}>Descent here <kbd>D</kbd></button>
      <button onclick={() => setAnchor("ascent")} disabled={!video?.dive}>Ascent here <kbd>A</kbd></button>
    </div>
    <Timeline {duration} {currentTime} dive={video?.dive} {sync}
              syncPoints={{ descent: video?.dive?.descent_s != null && video?.dive ? (video.dive.descent_s - sync.b) / sync.a : null,
                            ascent: video?.dive?.ascent_s != null && video?.dive ? (video.dive.ascent_s - sync.b) / sync.a : null }}
              reviewed={video?.reviewed || []} observations={video?.observations || []} onSeek={seek} {onDrag}
              dragHint={anchorCount === 0 ? "moves it" : anchorCount === 1 ? "stretches it around the sync point" : "fixed by both sync points"} />
  </div>

  <aside class="right">
    <ObservationPanel {draft} {stage} {busy} {terms} maxStills={MAX_STILLS} onOpenPicker={openPicker}
                      onComplete={complete} onBack={() => (stage = "capturing")} onUpload={upload} onDiscard={() => discard()}
                      onAnnotation={(attr, value) => { draft.annotations[attr] = value; }} />

    {#if missingLocation.length}
      <section class="notice">
        <strong>{missingLocation.length} observation{missingLocation.length === 1 ? "" : "s"} without a location.</strong>
        Set it on iNaturalist so they can reach research grade:
        {#each missingLocation as o}<a href="https://www.inaturalist.org/observations/{o.inat_id}/edit" target="_blank" rel="noreferrer">#{o.n}</a>{" "}{/each}
      </section>
    {/if}

    {#if recent.length}
      <section class="list">
        <h2>Observations from this video</h2>
        {#each recent as o (o.id)}
          <div class="row {o.status}">
            <button class="link" onclick={() => seek(o.t_vid)}>#{o.n} · {clock(o.t_vid)}</button>
            <span class="status">{o.status}</span>
            {#if o.url}<a href={o.url} target="_blank" rel="noreferrer">open on iNat</a>{/if}
            {#if o.status === "failed"}<button onclick={() => send(o.id)}>Retry</button>{/if}
            {#if o.status === "dry-run" && pendingUploads.has(o.id)}<button onclick={() => send(o.id, true)}>Upload for real</button>{/if}
            {#if o.error}<div class="err">{o.error}</div>{/if}
            {#if o.dropped?.length}<div class="muted small">iNat didn't accept {o.dropped.length} annotation{o.dropped.length === 1 ? "" : "s"}.</div>{/if}
            {#if o.preview}
              <details><summary>What would be sent</summary><pre>{o.preview.payload.observation.description}

{JSON.stringify({ ...o.preview.payload.observation, description: "…" }, null, 1)}
Photos: {o.preview.photos.map((p) => `${p.filename} (${Math.round(p.bytes / 1024)} KB)`).join(", ")}
Annotations: {JSON.stringify(o.preview.annotations)}</pre></details>
            {/if}
          </div>
        {/each}
      </section>
    {/if}
  </aside>
</main>

{#if pickerOpen}
  <FramePicker {draft} highlightId={pickerHighlight} maxStills={MAX_STILLS} {busy}
               onHighlight={(id) => (pickerHighlight = id)} onToggle={toggleFrame}
               onPosition={(f, p) => { f.position = p; }} onCrop={(f, box) => { f.cropBox = box; }}
               onClose={() => (pickerOpen = false)} onComplete={() => { pickerOpen = false; complete(); }} />
{/if}

{#if toast}<div class="toast {toast.kind}" role="status">{toast.message}</div>{/if}

<style>
  .top { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  h1 { font-size: 18px; margin: 0; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--track); color: var(--muted); }
  .chip.ok { color: var(--ok); }
  .chip.dry { background: var(--warn); color: #fff; }
  nav { margin-left: auto; display: flex; gap: 6px; }
  nav button.active { border-color: var(--accent); color: var(--accent); }
  .drawer { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--bg); max-height: 60vh; overflow: auto; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 460px; gap: 16px; padding: 12px 16px; }
  @media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
  .left { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .player-wrap { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 6px; overflow: hidden; }
  .player-wrap :global(iframe), .player-wrap :global(#yt-player) { position: absolute; inset: 0; width: 100%; height: 100%; }
  .placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: #aaa; }
  .error-box { margin: 0; padding: 8px 10px; border: 1px solid var(--danger); color: var(--danger); border-radius: 6px; }
  .nowbar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 13px; }
  .spacer { flex: 1; }
  .open-obs { color: var(--accent); }
  .right { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .right > :global(section) { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .notice { font-size: 13px; border-color: var(--warn) !important; }
  .list h2 { font-size: 14px; margin: 0 0 6px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding: 4px 0; border-top: 1px solid var(--border); font-size: 13px; }
  .row .status { font-size: 12px; color: var(--muted); }
  .row.uploaded .status { color: var(--ok); }
  .row.failed .status { color: var(--danger); }
  .row .err { flex-basis: 100%; color: var(--danger); font-size: 12px; }
  .row details { flex-basis: 100%; }
  .row pre { white-space: pre-wrap; font-size: 11px; font-family: var(--mono); background: var(--bg); padding: 6px; border-radius: 4px; }
  button.link { border: none; background: none; padding: 0; color: var(--accent); }
  .small { font-size: 12px; }
  .keys td { padding: 3px 10px 3px 0; font-size: 13px; }
  .toast { position: fixed; z-index: 60; bottom: 16px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: 6px; background: var(--text); color: var(--bg); max-width: min(90vw, 640px); box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .toast.error { background: var(--danger); color: #fff; }
</style>

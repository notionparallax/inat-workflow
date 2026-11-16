// Dive iNat frame grabber (SPEC §7.2).
//
// Runs inside YouTube embed frames, but only acts when the parent page is the
// Dive iNat tool. Reads frames straight from the <video> element at its decoded
// resolution and sends them to the parent page as JPEG blobs with exact media
// times.
(() => {
  "use strict";

  const VERSION = "0.2.0";
  // Pages allowed to use the grabber. Add the hosted domain here once registered.
  const ALLOWED_PARENTS = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
  const FROM_PAGE = "dive-inat";
  const TO_PAGE = "dive-inat-grabber";
  // Keys forwarded to the tool when focus is inside the player (§13).
  const OWN_KEYS = new Set(["n", "m", "c", "d", "a", ",", ".", "Escape", "Enter", "1", "2", "3", "4"]);

  const parentOrigin = location.ancestorOrigins && location.ancestorOrigins[0];
  if (!parentOrigin || !ALLOWED_PARENTS.some((re) => re.test(parentOrigin))) return;

  const video = () => document.querySelector("video");
  const send = (msg, transfer) => window.parent.postMessage({ source: TO_PAGE, ...msg }, parentOrigin, transfer);

  // --- Frame-rate estimate from frames presented during playback -----------
  let fpsEstimate = null;
  let lastFrame = null;
  function watchFrames(v) {
    if (!v || !v.requestVideoFrameCallback || v.__diveInatWatched) return;
    v.__diveInatWatched = true;
    const onFrame = (_now, meta) => {
      if (lastFrame && !v.paused && v.playbackRate === 1) {
        const df = meta.presentedFrames - lastFrame.presentedFrames;
        const dt = meta.mediaTime - lastFrame.mediaTime;
        if (df === 1 && dt > 0.005 && dt < 0.1) {
          const fps = 1 / dt;
          fpsEstimate = fpsEstimate ? fpsEstimate * 0.9 + fps * 0.1 : fps;
        }
      }
      lastFrame = meta;
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }
  const roundFps = () => {
    if (!fpsEstimate) return null;
    const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
    return common.reduce((best, f) => (Math.abs(f - fpsEstimate) < Math.abs(best - fpsEstimate) ? f : best));
  };

  // --- Exact seeking ---------------------------------------------------------
  function seekExact(v, t) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (mediaTime) => {
        if (done) return;
        done = true;
        resolve(mediaTime);
      };
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        if (v.requestVideoFrameCallback) {
          v.requestVideoFrameCallback((_now, meta) => finish(meta.mediaTime));
          setTimeout(() => finish(v.currentTime), 400);
        } else {
          finish(v.currentTime);
        }
      };
      v.addEventListener("seeked", onSeeked);
      v.currentTime = Math.max(0, t);
      setTimeout(() => finish(v.currentTime), 3000);
    });
  }

  // --- Capture and sharpness -------------------------------------------------
  // Variance of the Laplacian on a downscaled greyscale copy: higher = sharper.
  function sharpness(source, w, h) {
    const sw = Math.min(640, w);
    const sh = Math.round((h * sw) / w);
    const c = new OffscreenCanvas(sw, sh);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, sw, sh);
    const { data } = ctx.getImageData(0, 0, sw, sh);
    const g = new Float32Array(sw * sh);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const k = y * sw + x;
        const lap = g[k - sw] + g[k + sw] + g[k - 1] + g[k + 1] - 4 * g[k];
        sum += lap; sumSq += lap * lap; n++;
      }
    }
    const mean = sum / n;
    return Math.round((sumSq / n - mean * mean) * 10) / 10;
  }

  async function capture(v, quality) {
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) throw new Error("The video hasn't loaded a frame yet.");
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d").drawImage(v, 0, 0, w, h);
    const score = sharpness(c, w, h);
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: quality || 0.92 });
    return { width: w, height: h, sharpness: score, blob };
  }

  // --- Commands ----------------------------------------------------------------
  const commands = {
    ping: () => ({ version: VERSION, videoFound: !!video() }),

    status: () => {
      const v = video();
      if (!v) return { videoFound: false };
      watchFrames(v);
      return {
        videoFound: true, videoWidth: v.videoWidth, videoHeight: v.videoHeight,
        currentTime: v.currentTime, duration: v.duration, paused: v.paused, fps: roundFps(),
      };
    },

    grab: async ({ quality } = {}) => {
      const v = video();
      if (!v) throw new Error("No video found in the player.");
      const frame = await capture(v, quality);
      return { ...frame, time: v.currentTime };
    },

    seek: async ({ time }) => {
      const v = video();
      return { time: await seekExact(v, time) };
    },

    step: async ({ frames = 1, fps }) => {
      const v = video();
      v.pause();
      const rate = fps || roundFps() || 30;
      return { time: await seekExact(v, v.currentTime + frames / rate + 0.001) };
    },

    // Play through center-before … center+after and capture frames as they're
    // presented. Much faster than seeking frame by frame. Frames are streamed
    // to the page as they're ready.
    //   mode "jpeg": full-resolution JPEG + sharpness (stills)
    //   mode "rgba": raw pixels of `box` (fractions) scaled to `width` (GIFs),
    //                taking frames at `fps`
    record: async ({ center, before = 0.5, after = 0.5, rate = 1, mode = "jpeg", quality, width, box, fps, maxFrames = 240 }, progress) => {
      const v = video();
      if (!v) throw new Error("No video found in the player.");
      const start = Math.max(0, center - before), end = center + after;
      const was = { playing: !v.paused, rate: v.playbackRate, muted: v.muted };
      v.pause();
      await seekExact(v, Math.max(0, start - 0.05));
      v.muted = true;
      v.playbackRate = rate;

      const W = v.videoWidth, H = v.videoHeight;
      const crop = box ? { sx: box.x * W, sy: box.y * H, sw: box.s * W, sh: box.s * H } : { sx: 0, sy: 0, sw: W, sh: H };
      const outW = mode === "rgba" ? Math.min(width || 800, Math.round(crop.sw)) : W;
      const outH = mode === "rgba" ? Math.round((crop.sh * outW) / crop.sw) : H;
      const step = mode === "rgba" && fps ? 1 / fps : 0;
      let nextTime = start;
      let count = 0;
      const pending = [];

      // Turn a snapshot into a frame message; runs while recording continues.
      const finish = async (bitmapPromise, time) => {
        const bmp = await bitmapPromise;
        if (mode === "rgba") {
          const c = new OffscreenCanvas(outW, outH);
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0, outW, outH);
          bmp.close();
          const data = ctx.getImageData(0, 0, outW, outH).data;
          progress({ time, width: outW, height: outH, data: data.buffer }, [data.buffer]);
        } else {
          const c = new OffscreenCanvas(W, H);
          c.getContext("2d").drawImage(bmp, 0, 0);
          bmp.close();
          const score = sharpness(c, W, H);
          const blob = await c.convertToBlob({ type: "image/jpeg", quality: quality || 0.92 });
          progress({ time, width: W, height: H, sharpness: score, blob });
        }
      };

      await new Promise((resolve) => {
        let stopped = false;
        const stop = () => { if (!stopped) { stopped = true; v.pause(); resolve(); } };
        const halfFrame = 0.5 / (roundFps() || 30);
        const onFrame = (_now, meta) => {
          if (stopped) return;
          const t = meta.mediaTime;
          if (t >= start - 1e-3 && t <= end + 1e-3 && count < maxFrames && (!step || t >= nextTime - halfFrame)) {
            // Snapshot now (createImageBitmap copies the current frame); process later.
            const snap = mode === "rgba"
              ? createImageBitmap(v, crop.sx, crop.sy, crop.sw, crop.sh, { resizeWidth: outW, resizeHeight: outH, resizeQuality: "high" })
              : createImageBitmap(v);
            pending.push(finish(snap, t));
            count++;
            if (step) while (nextTime <= t + halfFrame) nextTime += step;
          }
          if (t >= end || count >= maxFrames) return stop();
          v.requestVideoFrameCallback(onFrame);
        };
        v.requestVideoFrameCallback(onFrame);
        v.play();
        setTimeout(stop, ((end - start) / rate) * 1000 + 20000); // stalled buffering
      });
      await Promise.all(pending);

      v.playbackRate = was.rate;
      v.muted = was.muted;
      await seekExact(v, center);
      if (was.playing) v.play();
      return { count, start, end };
    },

    // Step through every frame from center-before to center+after (older, slower method).
    burst: async ({ center, before = 0.5, after = 0.5, fps, quality, maxFrames = 90 }) => {
      const v = video();
      if (!v) throw new Error("No video found in the player.");
      const wasPlaying = !v.paused;
      v.pause();
      const rate = fps || roundFps() || 30;
      const start = Math.max(0, center - before);
      const count = Math.min(maxFrames, Math.round((before + after) * rate) + 1);
      const frames = [];
      let lastTime = null;
      for (let k = 0; k < count; k++) {
        // Aim for the middle of each frame's display interval.
        const target = start + (k + 0.5) / rate;
        const mediaTime = await seekExact(v, target);
        if (lastTime !== null && Math.abs(mediaTime - lastTime) < 1e-4) continue;
        lastTime = mediaTime;
        const frame = await capture(v, quality);
        frames.push({ ...frame, time: mediaTime });
      }
      await seekExact(v, center);
      if (wasPlaying) v.play();
      return { frames, fps: rate };
    },

    quality: ({ level = "hd2160" } = {}) =>
      new Promise((resolve) => {
        const onReply = (e) => {
          window.removeEventListener("dive-inat-quality-reply", onReply);
          resolve(JSON.parse(e.detail || "{}"));
        };
        window.addEventListener("dive-inat-quality-reply", onReply);
        window.dispatchEvent(new CustomEvent("dive-inat-quality", { detail: JSON.stringify({ level }) }));
        setTimeout(() => resolve({ ok: false, error: "No reply from player" }), 1500);
      }),
  };

  window.addEventListener("message", async (event) => {
    if (event.origin !== parentOrigin) return;
    const msg = event.data;
    if (!msg || msg.source !== FROM_PAGE || !commands[msg.cmd]) return;
    try {
      const progress = (frame, transfer) => send({ id: msg.id, type: "frame", frame }, transfer);
      const result = await commands[msg.cmd](msg.args || {}, progress);
      send({ id: msg.id, ok: true, result });
    } catch (err) {
      send({ id: msg.id, ok: false, error: String((err && err.message) || err) });
    }
  });

  // Forward the tool's shortcut keys when focus is inside the player.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!OWN_KEYS.has(key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      send({ type: "key", key, shiftKey: e.shiftKey });
    },
    true,
  );

  const hello = () => {
    watchFrames(video());
    send({ type: "hello", version: VERSION });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello);
  else hello();
  // The <video> element can be created late; start the fps watcher when it appears.
  new MutationObserver(() => watchFrames(video())).observe(document.documentElement, { childList: true, subtree: true });
})();

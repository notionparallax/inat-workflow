<script>
  // Make an animated GIF around the current frame (SPEC §9.7). Shown inside the
  // frame picker. Frames are captured at GIF frame rate by the extension and
  // encoded in the browser.
  import { clock } from "../lib/dive.js";
  import { encodeGif, GIF_DEFAULTS } from "../lib/gif.js";

  let { frame, existing = null, capture, onUse, onClose, onError } = $props();

  let before = $state(GIF_DEFAULTS.before);
  let after = $state(GIF_DEFAULTS.after);
  let fps = $state(GIF_DEFAULTS.fps);
  let width = $state(GIF_DEFAULTS.width);
  let useCrop = $state(!!frame?.cropBox);
  let busy = $state("");

  const duration = $derived(before + after);
  const frameCount = $derived(Math.round(duration * fps) + 1);

  // A finished GIF goes straight onto the observation (replacing any earlier
  // one); the draft owns its object URL.
  async function make() {
    try {
      busy = "Capturing frames…";
      // Plain copy: a reactive proxy can't be posted to the extension.
      const box = useCrop && frame.cropBox ? { x: frame.cropBox.x, y: frame.cropBox.y, s: frame.cropBox.s } : null;
      const prepared = await capture({ center: frame.time, before, after, fps, width, box },
                                     (n) => (busy = `Capturing frames… ${n} of ≈${frameCount}`));
      busy = "Encoding GIF…";
      const gif = await encodeGif(prepared, { fps });
      onUse({ ...gif, url: URL.createObjectURL(gif.blob), start: frame.time - before, end: frame.time + after, cropped: !!box });
    } catch (e) {
      onError(e.message);
    } finally {
      busy = "";
    }
  }
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
</script>

<div class="gif">
  <header>
    <strong>Animated GIF</strong>
    <span class="muted">around {clock(frame.time)} · uploaded as the first photo, so it becomes the thumbnail</span>
    <span class="spacer"></span>
    <button onclick={onClose}>Back to frames <kbd>Esc</kbd></button>
  </header>

  <div class="opts">
    <label>Seconds before <input type="number" min="0" max="5" step="0.1" bind:value={before} /></label>
    <label>Seconds after <input type="number" min="0" max="5" step="0.1" bind:value={after} /></label>
    <label>Frames per second
      <select bind:value={fps}>{#each [6, 8, 10, 12, 15] as f}<option value={f}>{f}</option>{/each}</select>
    </label>
    <label>Width (px) <input type="number" min="320" max="1200" step="40" bind:value={width} /></label>
    <label class="check" title={frame.cropBox ? "" : "Add a crop box to this frame first (R)"}>
      <input type="checkbox" bind:checked={useCrop} disabled={!frame.cropBox} /> Only the crop box area
    </label>
    <span class="muted">{duration.toFixed(1)} s · {frameCount} frames</span>
    <button class="primary" onclick={make} disabled={!!busy || duration <= 0}>{busy || (existing ? "Make again" : "Make GIF")}</button>
  </div>

  <div class="preview">
    {#if existing}
      {#key existing.url}<img src={existing.url} alt="This observation's GIF" />{/key}
      <div class="info">
        <p>This observation's GIF: {existing.width}×{existing.height} · {existing.frames} frames at {existing.fps} fps · {mb(existing.bytes)} MB{existing.colors < 256 ? ` · reduced to ${existing.colors} colours to fit 5 MB` : ""}{existing.cropped ? " · crop box area" : ""}</p>
        <p class="muted">Making it again replaces it.</p>
        <button class="primary" onclick={onClose}>Done</button>
      </div>
    {:else}
      <p class="muted">Choose the stretch of video either side of this frame, then make the GIF. Movement of the
        camera around the organism helps identifiers see its shape; 2–4 seconds is usually plenty.</p>
    {/if}
  </div>
</div>

<style>
  .gif { flex: 1; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  kbd { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.25); color: inherit; }
  header, .opts { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; }
  .spacer { flex: 1; }
  label { display: flex; align-items: center; gap: 6px; }
  input[type="number"] { width: 72px; }
  .preview { flex: 1; min-height: 0; display: flex; gap: 16px; align-items: flex-start; }
  .preview img { max-width: 70%; max-height: calc(100vh - 260px); object-fit: contain; border: 1px solid rgba(255,255,255,.2); }
  .info p { margin: 0 0 8px; font-size: 13px; }
  input, select { background: rgba(255,255,255,.08); color: inherit; border-color: rgba(255,255,255,.25); }
  button:not(.primary) { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.2); color: inherit; }
  .muted { color: #9aa9b6; }
</style>

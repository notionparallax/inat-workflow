<script>
  // Full-screen frame picker (SPEC §9.1): a large view of one frame at a time,
  // with every captured frame in a strip underneath. Selected frames can carry
  // a subject position (§9.8) and a crop box (§9.9).
  import { clock, region } from "../lib/dive.js";
  import { canCrop, defaultCropBox, minCropSize as minS } from "../lib/frames.js";

  let { draft, highlightId, maxStills = 4, busy = false, onHighlight, onToggle, onPosition, onCrop, onClose, onComplete } = $props();

  const frames = $derived(draft ? [...draft.frames].sort((a, b) => a.burst - b.burst || a.time - b.time) : []);
  const current = $derived(frames.find((f) => f.id === highlightId) || frames[0]);
  const index = $derived(current ? frames.indexOf(current) : -1);
  const selectedCount = $derived(frames.filter((f) => f.selected).length);
  const latestBurst = $derived(Math.max(0, ...frames.map((f) => f.burst)));
  const stillNo = (f) => frames.filter((x) => x.selected).sort((a, b) => a.time - b.time).indexOf(f) + 1;

  // Crop box {x, y, s} as fractions of the frame. It keeps the frame's aspect
  // ratio, so width and height are the same fraction s, never below iNat's
  // maximum photo size.
  function toggleCrop(f = current) {
    if (!f.selected || !canCrop(f)) return;
    onCrop(f, f.cropBox ? null : defaultCropBox(f));
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  let imgEl = $state();
  let dragging = null;
  let justDragged = false;

  function boxDown(e, mode) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging = { mode, x0: e.clientX, y0: e.clientY, box: { ...current.cropBox }, rect: imgEl.getBoundingClientRect() };
  }
  function boxMove(e) {
    if (!dragging) return;
    const { box, rect, mode } = dragging;
    const dx = (e.clientX - dragging.x0) / rect.width;
    const dy = (e.clientY - dragging.y0) / rect.height;
    let next;
    if (mode === "move") {
      next = { ...box, x: clamp(box.x + dx, 0, 1 - box.s), y: clamp(box.y + dy, 0, 1 - box.s) };
    } else {
      // Resize from the bottom-right corner; top-left stays put.
      const s = clamp(box.s + Math.max(dx, dy), minS(current), Math.min(1 - box.x, 1 - box.y));
      next = { ...box, s };
    }
    onCrop(current, next);
  }
  function boxUp() {
    if (dragging) justDragged = true;
    dragging = null;
  }

  function clickImage(e) {
    if (justDragged) { justDragged = false; return; }
    const r = imgEl.getBoundingClientRect();
    const pos = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
    if (!current.selected) {
      if (selectedCount >= maxStills) return onToggle(current); // shows the "up to 4" message
      onToggle(current);
    }
    onPosition(current, pos);
  }

  const cropPx = (f) => f.cropBox && `${Math.round(f.cropBox.s * f.width)}×${Math.round(f.cropBox.s * f.height)}`;

  let stripEl = $state();
  $effect(() => {
    const el = stripEl?.querySelector(`[data-id="${current?.id}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  });
</script>

{#if draft && current}
  <div class="backdrop" role="dialog" aria-modal="true" aria-label="Choose frames">
    <header>
      <strong>Observation {draft.n}</strong>
      <span>Frame {index + 1} of {frames.length} · burst {current.burst} · {clock(current.time)} ({current.time.toFixed(3)} s) · sharpness {current.sharpness}{current.rank === 1 ? " (sharpest in burst)" : ""} · {current.width}×{current.height}</span>
      <span class="count">{selectedCount} of up to {maxStills} selected</span>
      <span class="spacer"></span>
      <button onclick={onClose} title="Close the picker and keep watching; press M again to add frames from later in the video">More angles later in the video <kbd>M</kbd></button>
      <button class="primary" onclick={onComplete} disabled={!selectedCount || busy}>Complete <kbd>C</kbd></button>
      <button onclick={onClose}>Close <kbd>Esc</kbd></button>
    </header>

    <div class="stage">
      <button class="nav" onclick={() => onHighlight(frames[Math.max(0, index - 1)].id)} disabled={index <= 0} aria-label="Previous frame">‹</button>
      <div class="imgwrap">
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="imgbox" onclick={clickImage} onpointermove={boxMove} onpointerup={boxUp}>
          <img bind:this={imgEl} src={current.url} alt="Frame at {current.time.toFixed(2)} s" draggable="false" />
          {#if current.position}<span class="pin" style="left:{current.position.x}%;top:{current.position.y}%"></span>{/if}
          {#if current.cropBox}
            <div class="crop" style="left:{current.cropBox.x * 100}%;top:{current.cropBox.y * 100}%;width:{current.cropBox.s * 100}%;height:{current.cropBox.s * 100}%"
                 onpointerdown={(e) => boxDown(e, "move")}>
              <span class="crop-label">Crop {cropPx(current)}</span>
              <span class="handle" onpointerdown={(e) => boxDown(e, "resize")}></span>
            </div>
          {/if}
        </div>
        {#if current.selected}<span class="badge">Photo {stillNo(current)}</span>{/if}
      </div>
      <button class="nav" onclick={() => onHighlight(frames[Math.min(frames.length - 1, index + 1)].id)} disabled={index >= frames.length - 1} aria-label="Next frame">›</button>
    </div>

    <div class="controls">
      <button class:primary={!current.selected} onclick={() => onToggle(current)}>
        {current.selected ? "Deselect" : "Select"} this frame <kbd>Space</kbd>
      </button>
      {#if current.selected && canCrop(current)}
        <button onclick={() => toggleCrop()}>{current.cropBox ? "Remove crop" : "Add crop"} <kbd>R</kbd></button>
      {/if}
      {#if current.position}
        <span>Subject {Math.round(current.position.x)}% across, {Math.round(current.position.y)}% down ({region(current.position.x, current.position.y)})</span>
        <button onclick={() => onPosition(current, null)}>Clear position</button>
      {/if}
      <span class="spacer"></span>
      <span class="muted help">
        Select up to {maxStills} frames: <kbd>Space</kbd>, the <b>+</b> on a thumbnail, or click the organism (also marks where it is).
        A crop is uploaded as an extra photo; drag it to move, drag its corner to resize. <kbd>←</kbd>/<kbd>→</kbd> next/previous frame.
      </span>
    </div>

    <div class="strip" bind:this={stripEl}>
      {#each frames as f (f.id)}
        <div class="thumb" class:current={f.id === current.id} class:selected={f.selected} data-id={f.id}>
          <button class="pick" onclick={() => onHighlight(f.id)} title="Burst {f.burst} · {f.time.toFixed(3)} s · sharpness {f.sharpness}">
            <img src={f.url} alt="" loading="lazy" />
            {#if f.cropBox}<span class="mini-crop" style="left:{f.cropBox.x * 100}%;top:{f.cropBox.y * 100}%;width:{f.cropBox.s * 100}%;height:{f.cropBox.s * 100}%"></span>{/if}
          </button>
          {#if f.burst === latestBurst && f.rank <= 9}<span class="rank">{f.rank}</span>{/if}
          <button class="sel" onclick={() => onToggle(f)} aria-label={f.selected ? `Deselect photo ${stillNo(f)}` : "Select this frame"}>
            {f.selected ? `✓ ${stillNo(f)}` : "+"}
          </button>
          <span class="bar" style="width:{Math.min(100, (f.sharpness / Math.max(...frames.filter((x) => x.burst === f.burst).map((x) => x.sharpness))) * 100)}%"></span>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; background: rgba(8, 12, 16, 0.95); color: #e8eef3; }
  header, .controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; }
  .count { color: #8fd3f0; }
  .spacer { flex: 1; }
  .help { max-width: 620px; font-size: 12px; }
  .stage { flex: 1; min-height: 0; display: flex; align-items: center; gap: 8px; }
  .imgwrap { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; justify-content: center; }
  .imgbox { position: relative; line-height: 0; cursor: crosshair; touch-action: none; }
  .imgbox img { display: block; max-width: 100%; max-height: calc(100vh - 300px); object-fit: contain; user-select: none; }
  .pin { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 0 3px #0b6e99, 0 0 12px rgba(0,0,0,.6); pointer-events: none; }
  .crop { position: absolute; border: 2px dashed #fff; box-shadow: 0 0 0 9999px rgba(0,0,0,.45); cursor: move; }
  .crop-label { position: absolute; left: 4px; top: 4px; font-size: 12px; line-height: 1.4; background: rgba(0,0,0,.65); padding: 0 6px; border-radius: 3px; pointer-events: none; }
  .handle { position: absolute; right: -8px; bottom: -8px; width: 16px; height: 16px; background: #fff; border: 2px solid #0b6e99; border-radius: 3px; cursor: nwse-resize; }
  .badge { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); background: #0b6e99; color: #fff; padding: 2px 10px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
  .nav { flex: 0 0 auto; font-size: 32px; line-height: 1; padding: 8px 12px; background: rgba(255,255,255,.08); color: #fff; border-color: transparent; }
  .strip { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0 6px; }
  .thumb { position: relative; flex: 0 0 auto; border: 3px solid transparent; border-radius: 4px; }
  .pick { position: relative; display: block; padding: 0; border: none; background: none; line-height: 0; overflow: hidden; }
  .pick img { display: block; width: 176px; height: 99px; object-fit: cover; border-radius: 2px; }
  .mini-crop { position: absolute; border: 1px dashed #fff; pointer-events: none; }
  .thumb.current { border-color: #fff; }
  .thumb.selected { border-color: #4fb3dd; }
  .thumb.current.selected { border-color: #9fe0ff; }
  .rank { position: absolute; left: 4px; top: 4px; background: rgba(0,0,0,.7); color: #fff; font-size: 12px; padding: 0 5px; border-radius: 3px; pointer-events: none; }
  .sel { position: absolute; right: 4px; top: 4px; min-width: 26px; padding: 0 6px; font-size: 13px; line-height: 22px; border-radius: 4px; background: rgba(0,0,0,.65); color: #fff; border: 1px solid rgba(255,255,255,.5); }
  .thumb.selected .sel { background: #0b6e99; border-color: #0b6e99; }
  .bar { position: absolute; left: 0; bottom: 0; height: 4px; background: #5cc278; pointer-events: none; }
  button { color: inherit; }
  header button:not(.primary), .controls button:not(.primary) { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.2); }
  kbd { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.25); color: inherit; }
  .muted { color: #9aa9b6; }
</style>

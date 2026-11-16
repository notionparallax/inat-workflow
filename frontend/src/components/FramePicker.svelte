<script>
  // Full-screen frame picker (SPEC §9.1): a large view of one frame at a time,
  // with every captured frame in a strip underneath.
  import { clock, region } from "../lib/dive.js";

  let { draft, highlightId, maxStills = 4, busy = false, onHighlight, onToggle, onPosition, onClose, onComplete, onMark } = $props();

  const frames = $derived(draft ? [...draft.frames].sort((a, b) => a.burst - b.burst || a.time - b.time) : []);
  const current = $derived(frames.find((f) => f.id === highlightId) || frames[0]);
  const index = $derived(current ? frames.indexOf(current) : -1);
  const selectedCount = $derived(frames.filter((f) => f.selected).length);
  const latestBurst = $derived(Math.max(0, ...frames.map((f) => f.burst)));
  const stillNo = (f) => frames.filter((x) => x.selected).sort((a, b) => a.time - b.time).indexOf(f) + 1;

  function clickImage(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const pos = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
    if (!current.selected) {
      if (selectedCount >= maxStills) return onToggle(current); // shows the "up to 4" message
      onToggle(current);
    }
    onPosition(current, pos);
  }

  let stripEl = $state();
  $effect(() => {
    // Keep the highlighted thumbnail in view.
    const el = stripEl?.querySelector(`[data-id="${current?.id}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  });
</script>

{#if draft && current}
  <div class="backdrop" role="dialog" aria-modal="true" aria-label="Choose frames">
    <header>
      <strong>Observation {draft.n}</strong>
      <span>Frame {index + 1} of {frames.length} · burst {current.burst} · {clock(current.time)} ({current.time.toFixed(3)} s) · sharpness {current.sharpness}{current.rank === 1 ? " (sharpest in burst)" : ""} · {current.width}×{current.height}</span>
      <span class="count">{selectedCount}/{maxStills} selected</span>
      <span class="spacer"></span>
      <button onclick={onMark} disabled={busy}>{busy ? "Capturing…" : "Capture more"} <kbd>M</kbd></button>
      <button class="primary" onclick={onComplete} disabled={!selectedCount}>Complete <kbd>C</kbd></button>
      <button onclick={onClose}>Close <kbd>Esc</kbd></button>
    </header>

    <div class="stage">
      <button class="nav" onclick={() => onHighlight(frames[Math.max(0, index - 1)].id)} disabled={index <= 0} aria-label="Previous frame">‹</button>
      <div class="imgwrap">
        <button class="imgbtn" onclick={clickImage} aria-label="Select this frame and mark where the organism is">
          <img src={current.url} alt="Frame at {current.time.toFixed(2)} s" />
          {#if current.position}<span class="pin" style="left:{current.position.x}%;top:{current.position.y}%"></span>{/if}
        </button>
        {#if current.selected}<span class="badge">Photo {stillNo(current)}</span>{/if}
      </div>
      <button class="nav" onclick={() => onHighlight(frames[Math.min(frames.length - 1, index + 1)].id)} disabled={index >= frames.length - 1} aria-label="Next frame">›</button>
    </div>

    <div class="controls">
      <button class:primary={!current.selected} onclick={() => onToggle(current)}>
        {current.selected ? "Deselect" : "Select"} this frame <kbd>Space</kbd>
      </button>
      {#if current.position}
        <span>Subject at {Math.round(current.position.x)}% across, {Math.round(current.position.y)}% down ({region(current.position.x, current.position.y)})</span>
        <button onclick={() => onPosition(current, null)}>Clear position</button>
      {:else}
        <span class="muted">Click the organism in the picture to select the frame and mark where it is.</span>
      {/if}
      <span class="spacer"></span>
      <span class="muted"><kbd>←</kbd>/<kbd>→</kbd> or <kbd>,</kbd>/<kbd>.</kbd> previous/next · <kbd>1</kbd>–<kbd>9</kbd> sharpest frames of the latest burst</span>
    </div>

    <div class="strip" bind:this={stripEl}>
      {#each frames as f (f.id)}
        <button class="thumb" class:current={f.id === current.id} class:selected={f.selected} data-id={f.id}
                onclick={() => onHighlight(f.id)} title="Burst {f.burst} · {f.time.toFixed(3)} s · sharpness {f.sharpness}">
          <img src={f.url} alt="" loading="lazy" />
          {#if f.burst === latestBurst && f.rank <= 9}<span class="rank">{f.rank}</span>{/if}
          {#if f.selected}<span class="tick">{stillNo(f)}</span>{/if}
          <span class="bar" style="width:{Math.min(100, (f.sharpness / Math.max(...frames.filter((x) => x.burst === f.burst).map((x) => x.sharpness))) * 100)}%"></span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; background: rgba(8, 12, 16, 0.94); color: #e8eef3; }
  header, .controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; }
  .count { color: #8fd3f0; }
  .spacer { flex: 1; }
  .stage { flex: 1; min-height: 0; display: flex; align-items: center; gap: 8px; }
  .imgwrap { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; justify-content: center; }
  .imgbtn { position: relative; padding: 0; border: none; background: none; cursor: crosshair; max-width: 100%; max-height: 100%; line-height: 0; }
  .imgbtn img { display: block; max-width: 100%; max-height: calc(100vh - 290px); object-fit: contain; }
  .pin { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 0 3px #0b6e99, 0 0 12px rgba(0,0,0,.6); pointer-events: none; }
  .badge { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); background: #0b6e99; color: #fff; padding: 2px 10px; border-radius: 10px; font-size: 13px; }
  .nav { flex: 0 0 auto; font-size: 32px; line-height: 1; padding: 8px 12px; background: rgba(255,255,255,.08); color: #fff; border-color: transparent; }
  .strip { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0 6px; }
  .thumb { position: relative; flex: 0 0 auto; padding: 0; border: 3px solid transparent; border-radius: 4px; background: none; }
  .thumb img { display: block; width: 176px; height: 99px; object-fit: cover; border-radius: 2px; }
  .thumb.current { border-color: #fff; }
  .thumb.selected { border-color: #4fb3dd; }
  .thumb.current.selected { border-color: #9fe0ff; }
  .rank { position: absolute; left: 4px; top: 4px; background: rgba(0,0,0,.7); color: #fff; font-size: 12px; padding: 0 5px; border-radius: 3px; }
  .tick { position: absolute; right: 4px; top: 4px; background: #0b6e99; color: #fff; font-size: 12px; padding: 0 6px; border-radius: 3px; }
  .bar { position: absolute; left: 0; bottom: 0; height: 4px; background: #5cc278; }
  button { color: inherit; }
  header button:not(.primary), .controls button:not(.primary) { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.2); }
  kbd { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.25); color: inherit; }
  .muted { color: #9aa9b6; }
</style>

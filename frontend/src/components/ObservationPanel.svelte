<script>
  // The observation in progress (SPEC §9.1): filmstrip, still selection,
  // subject position, annotations, then upload.
  import { clock, region } from "../lib/dive.js";

  let { draft, stage, busy, terms = [], maxStills = 4, onToggle, onPosition, onCropToggle, onComplete, onBack,
        onUpload, onDiscard, onAnnotation } = $props();

  const selected = $derived(draft ? draft.frames.filter((f) => f.selected).sort((a, b) => a.time - b.time) : []);
  const latestBurst = $derived(draft ? Math.max(0, ...draft.frames.map((f) => f.burst)) : 0);
  const bursts = $derived.by(() => {
    if (!draft) return [];
    const groups = new Map();
    for (const f of draft.frames) {
      if (!groups.has(f.burst)) groups.set(f.burst, []);
      groups.get(f.burst).push(f);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  });

  const KINGDOM_HINT = { 1: "animals", 47126: "plants", 211194: "vascular plants", 48460: "all life" };
  const hint = (t) => t.taxon_ids.map((id) => KINGDOM_HINT[id] || `taxon ${id}`).join(", ");

  function clickStill(e, frame) {
    const r = e.currentTarget.getBoundingClientRect();
    onPosition(frame, { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  }
</script>

<section class="panel">
  {#if !draft}
    <h2>No observation in progress</h2>
    <p class="muted">Watch the video, and press <kbd>M</kbd> when you see something. That captures a burst of frames
      around the moment and starts an observation. <kbd>Shift</kbd>+<kbd>M</kbd> captures just the current frame.</p>
  {:else}
    <header>
      <h2>Observation {draft.n}</h2>
      <span class="muted">{selected.length}/{maxStills} stills selected</span>
    </header>

    {#if stage === "capturing"}
      {#if busy}<p class="busy">Capturing frames…</p>{/if}
      {#each bursts as [burstNo, frames]}
        <div class="burst">
          <div class="burst-head">
            <span>Burst {burstNo}</span>
            <span class="muted">{clock(frames[0].time)} · {frames.length} frame{frames.length === 1 ? "" : "s"} · {frames[0].width}×{frames[0].height}</span>
          </div>
          <div class="strip">
            {#each frames as f (f.id)}
              <button class="thumb" class:selected={f.selected} class:best={f.rank === 1}
                      onclick={() => onToggle(f)} title="Sharpness {f.sharpness} · {f.time.toFixed(3)} s">
                <img src={f.url} alt="Frame at {f.time.toFixed(2)} s" loading="lazy" />
                {#if burstNo === latestBurst && f.rank <= 9}<span class="rank">{f.rank}</span>{/if}
                {#if f.selected}<span class="tick">✓</span>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/each}
      <p class="muted small">Numbers show the sharpest frames of the latest burst: press <kbd>1</kbd>–<kbd>9</kbd> to select or
        deselect them, or click any frame. Press <kbd>M</kbd> again to capture more angles of the same organism.</p>

      {#if selected.length}
        <h3>Selected stills <span class="muted small">— click the organism to mark where it is</span></h3>
        <div class="stills">
          {#each selected as f, i (f.id)}
            <figure>
              <button class="still" onclick={(e) => clickStill(e, f)} aria-label="Mark subject position on photo {i + 1}">
                <img src={f.url} alt="Selected still {i + 1}" />
                {#if f.position}
                  <span class="pin" style="left:{f.position.x}%;top:{f.position.y}%"></span>
                {/if}
              </button>
              <figcaption>
                Photo {i + 1} · {clock(f.time)}
                {#if f.position}
                  · {Math.round(f.position.x)}%, {Math.round(f.position.y)}% ({region(f.position.x, f.position.y)})
                  <label class="crop"><input type="checkbox" checked={f.crop} onchange={() => onCropToggle(f)} /> detail crop</label>
                {/if}
              </figcaption>
            </figure>
          {/each}
        </div>
      {/if}

      <div class="actions">
        <button class="primary" disabled={!selected.length || busy} onclick={onComplete}>Complete <kbd>C</kbd></button>
        <button onclick={onDiscard}>Discard <kbd>Esc</kbd></button>
      </div>
    {:else if stage === "annotating"}
      <h3>Annotations <span class="muted small">— all unset unless you choose; iNat drops any that don't apply</span></h3>
      <div class="terms">
        {#each terms as t (t.id)}
          <div class="term">
            <div class="term-label">{t.label} <span class="muted small">({hint(t)})</span></div>
            <div class="values">
              <button class:on={!draft.annotations[t.id]} onclick={() => onAnnotation(t.id, null)}>Unset</button>
              {#each t.values as v (v.id)}
                <button class:on={draft.annotations[t.id] === v.id} onclick={() => onAnnotation(t.id, v.id)}>{v.label}</button>
              {/each}
            </div>
          </div>
        {:else}
          <p class="muted">Loading annotation options from iNaturalist…</p>
        {/each}
      </div>
      <div class="actions">
        <button class="primary" onclick={onUpload}>Upload <kbd>Enter</kbd></button>
        <button onclick={onBack}>Back to frames <kbd>Esc</kbd></button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .panel { display: flex; flex-direction: column; gap: 8px; }
  header { display: flex; align-items: baseline; justify-content: space-between; }
  h2 { font-size: 16px; margin: 0; }
  h3 { font-size: 14px; margin: 8px 0 4px; }
  .busy { color: var(--accent); margin: 0; }
  .burst { border: 1px solid var(--border); border-radius: 6px; padding: 6px; }
  .burst-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
  .strip { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; }
  .thumb { position: relative; flex: 0 0 auto; padding: 0; border: 2px solid transparent; border-radius: 4px; background: none; cursor: pointer; }
  .thumb img { display: block; width: 112px; height: 63px; object-fit: cover; border-radius: 2px; }
  .thumb.best { border-color: var(--accent-soft); }
  .thumb.selected { border-color: var(--accent); }
  .rank { position: absolute; left: 3px; top: 3px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; padding: 0 4px; border-radius: 3px; }
  .tick { position: absolute; right: 3px; top: 3px; background: var(--accent); color: #fff; font-size: 11px; padding: 0 4px; border-radius: 3px; }
  .stills { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
  figure { margin: 0; }
  .still { position: relative; display: block; width: 100%; padding: 0; border: 1px solid var(--border); background: none; cursor: crosshair; }
  .still img { display: block; width: 100%; }
  .pin { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 2px var(--accent); pointer-events: none; }
  figcaption { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .crop { margin-left: 6px; white-space: nowrap; }
  .actions { display: flex; gap: 8px; margin-top: 4px; }
  .terms { display: flex; flex-direction: column; gap: 8px; }
  .term-label { font-size: 13px; margin-bottom: 2px; }
  .values { display: flex; flex-wrap: wrap; gap: 4px; }
  .values button { font-size: 12px; padding: 2px 8px; }
  .values button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .small { font-size: 12px; }
</style>

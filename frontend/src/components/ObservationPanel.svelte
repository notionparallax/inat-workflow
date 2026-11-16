<script>
  // The observation in progress (SPEC §9.1). Frame choice happens in the
  // full-screen picker; this panel summarises it and holds annotations.
  import { clock, region } from "../lib/dive.js";

  let { draft, stage, busy, terms = [], maxStills = 4, onOpenPicker, onComplete, onBack, onUpload, onDiscard, onAnnotation } = $props();

  const selected = $derived(draft ? draft.frames.filter((f) => f.selected).sort((a, b) => a.time - b.time) : []);
  const burstCount = $derived(draft ? new Set(draft.frames.map((f) => f.burst)).size : 0);

  const KINGDOM_HINT = { 1: "animals", 47126: "plants", 211194: "vascular plants", 48460: "all life" };
  const hint = (t) => t.taxon_ids.map((id) => KINGDOM_HINT[id] || `taxon ${id}`).join(", ");
</script>

<section class="panel">
  {#if !draft}
    <h2>No observation in progress</h2>
    <p class="muted">Watch the video, and press <kbd>M</kbd> when you see something. That captures a burst of frames
      around the moment and opens them large so you can pick the sharpest. <kbd>Shift</kbd>+<kbd>M</kbd> captures just the current frame.</p>
  {:else}
    <header>
      <h2>Observation {draft.n}</h2>
      <span class="muted">{selected.length}/{maxStills} stills · {draft.frames.length} frames from {burstCount} burst{burstCount === 1 ? "" : "s"}</span>
    </header>

    {#if busy}<p class="busy">Capturing frames…</p>{/if}

    {#if selected.length}
      <div class="stills">
        {#each selected as f, i (f.id)}
          <figure>
            <button class="still" onclick={() => onOpenPicker(f.id)} aria-label="Open photo {i + 1} in the frame picker">
              <img src={f.url} alt="Selected still {i + 1}" />
              {#if f.position}<span class="pin" style="left:{f.position.x}%;top:{f.position.y}%"></span>{/if}
              {#if f.cropBox}<span class="cropmark" style="left:{f.cropBox.x * 100}%;top:{f.cropBox.y * 100}%;width:{f.cropBox.s * 100}%;height:{f.cropBox.s * 100}%"></span>{/if}
            </button>
            <figcaption>Photo {i + 1} · {clock(f.time)}{f.position ? ` · subject ${region(f.position.x, f.position.y)}` : ""}{f.cropBox ? " · + crop" : ""}</figcaption>
          </figure>
        {/each}
      </div>
    {:else if !busy}
      <p class="muted">No stills selected yet.</p>
    {/if}

    {#if stage === "capturing"}
      <div class="actions">
        <button onclick={() => onOpenPicker()} disabled={!draft.frames.length}>Choose frames</button>
        <button class="primary" disabled={!selected.length || busy} onclick={onComplete}>Complete <kbd>C</kbd></button>
        <button onclick={onDiscard}>Discard <kbd>Esc</kbd></button>
      </div>
      <p class="muted small">Press <kbd>M</kbd> again to capture more angles of the same organism.</p>
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
        <button class="primary" onclick={onUpload} disabled={busy}>Upload <kbd>Enter</kbd></button>
        <button onclick={onBack}>Back to frames <kbd>Esc</kbd></button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .panel { display: flex; flex-direction: column; gap: 8px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  h2 { font-size: 16px; margin: 0; }
  h3 { font-size: 14px; margin: 8px 0 4px; }
  .busy { color: var(--accent); margin: 0; }
  .stills { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  figure { margin: 0; }
  .still { position: relative; display: block; width: 100%; padding: 0; border: 1px solid var(--border); background: none; line-height: 0; }
  .still img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
  .cropmark { position: absolute; border: 1px dashed #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.4); pointer-events: none; }
  .pin { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 2px var(--accent); pointer-events: none; }
  figcaption { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .terms { display: flex; flex-direction: column; gap: 8px; }
  .term-label { font-size: 13px; margin-bottom: 2px; }
  .values { display: flex; flex-wrap: wrap; gap: 4px; }
  .values button { font-size: 12px; padding: 2px 8px; }
  .values button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .small { font-size: 12px; }
</style>

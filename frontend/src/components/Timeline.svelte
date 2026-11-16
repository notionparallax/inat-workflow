<script>
  // Video timeline with reviewed shading, observation markers and the depth
  // profile (SPEC §8.2, §11). Click to seek; drag the profile to adjust sync.
  import { clock, logToVideo } from "../lib/dive.js";

  let { duration = 0, currentTime = 0, dive = null, sync, syncPoints = {}, reviewed = [], observations = [],
        onSeek, onDrag } = $props();

  let width = $state(800);
  const H = 150, PROFILE_TOP = 26, PROFILE_H = 104;
  let drag = null;
  let hoverX = $state(null);

  const x = (t) => (duration ? (t / duration) * width : 0);
  const tAt = (px) => Math.max(0, Math.min(duration, (px / width) * duration));

  const maxDepth = $derived(Math.max(5, ...(dive?.samples || []).map((s) => s.depth)));
  const profilePath = $derived.by(() => {
    if (!dive?.samples?.length || !duration) return "";
    const pts = dive.samples.map((s) => [x(logToVideo(s.t, sync)), PROFILE_TOP + (s.depth / maxDepth) * PROFILE_H]);
    const first = pts[0], last = pts[pts.length - 1];
    return `M${first[0]},${PROFILE_TOP} ` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + ` L${last[0]},${PROFILE_TOP} Z`;
  });
  const depthTicks = $derived([0, 5, 10, 15, 20, 30, 40].filter((d) => d <= maxDepth));
  const hoverInfo = $derived.by(() => {
    if (hoverX == null || !duration) return null;
    const t = tAt(hoverX);
    return { t, label: clock(t) };
  });

  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { x0: e.offsetX, last: e.offsetX, moved: false, inProfile: e.offsetY > PROFILE_TOP - 6 };
  }
  function move(e) {
    hoverX = e.offsetX;
    if (!drag) return;
    if (Math.abs(e.offsetX - drag.x0) > 4 && drag.inProfile && dive) drag.moved = true;
    if (drag.moved) {
      const dt = ((e.offsetX - drag.last) / width) * duration;
      drag.last = e.offsetX;
      onDrag?.(dt);
    }
  }
  function up(e) {
    if (drag && !drag.moved) onSeek?.(tAt(e.offsetX));
    drag = null;
  }
  const statusClass = (o) => o.status;
</script>

<div class="timeline" bind:clientWidth={width}>
  <svg {width} height={H} role="slider" aria-label="Video timeline and depth profile" aria-valuenow={currentTime}
       aria-valuemin="0" aria-valuemax={duration} tabindex="-1"
       onpointerdown={down} onpointermove={move} onpointerup={up} onpointerleave={() => (hoverX = null)}>
    <rect class="track" x="0" y="0" {width} height="8" />
    {#each reviewed as [s, e]}
      <rect class="reviewed" x={x(s)} y="0" width={Math.max(1, x(e) - x(s))} height="8" />
    {/each}

    {#if dive}
      {#each depthTicks as d}
        <line class="grid" x1="0" x2={width} y1={PROFILE_TOP + (d / maxDepth) * PROFILE_H} y2={PROFILE_TOP + (d / maxDepth) * PROFILE_H} />
        <text class="tick" x="4" y={PROFILE_TOP + (d / maxDepth) * PROFILE_H - 2}>{d} m</text>
      {/each}
      <path class="profile" d={profilePath} />
    {:else}
      <text class="empty" x={width / 2} y={PROFILE_TOP + 50} text-anchor="middle">Load a dive log to see the depth profile</text>
    {/if}

    {#if syncPoints.descent != null}
      <g class="anchor" transform="translate({x(syncPoints.descent)},0)">
        <line y1="10" y2={H} /><text y={H - 4} x="3">descent</text>
      </g>
    {/if}
    {#if syncPoints.ascent != null}
      <g class="anchor" transform="translate({x(syncPoints.ascent)},0)">
        <line y1="10" y2={H} /><text y={H - 4} x="-3" text-anchor="end">ascent</text>
      </g>
    {/if}

    {#each observations as o}
      <circle class="marker {statusClass(o)}" cx={x(o.t_vid)} cy="17" r="5">
        <title>Observation {o.n} at {clock(o.t_vid)} – {o.status}</title>
      </circle>
    {/each}

    <line class="cursor" x1={x(currentTime)} x2={x(currentTime)} y1="0" y2={H} />
    {#if hoverInfo}
      <line class="hover" x1={hoverX} x2={hoverX} y1="0" y2={H} />
      <text class="hover-label" x={Math.min(hoverX + 4, width - 40)} y="22">{hoverInfo.label}</text>
    {/if}
  </svg>
  <div class="legend">
    <span><i class="sw reviewed"></i>reviewed</span>
    <span><i class="sw dot uploaded"></i>uploaded</span>
    <span><i class="sw dot dry-run"></i>dry run</span>
    <span><i class="sw dot uploading"></i>uploading</span>
    <span><i class="sw dot failed"></i>failed</span>
    <span class="hint">Click to jump · drag the profile sideways to line it up with the video</span>
  </div>
</div>

<style>
  .timeline { width: 100%; user-select: none; }
  svg { display: block; cursor: crosshair; touch-action: none; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; }
  .track { fill: var(--track); }
  .reviewed { fill: var(--accent-soft); }
  .grid { stroke: var(--border); stroke-dasharray: 2 3; }
  .tick { font-size: 10px; fill: var(--muted); }
  .profile { fill: var(--water); stroke: var(--water-line); stroke-width: 1.2; }
  .empty { font-size: 12px; fill: var(--muted); }
  .anchor line { stroke: var(--warn); stroke-dasharray: 4 3; }
  .anchor text { font-size: 10px; fill: var(--warn); }
  .marker { stroke: var(--surface); stroke-width: 1.5; cursor: pointer; }
  .uploaded { fill: var(--ok); }
  .dry-run { fill: var(--muted); }
  .uploading { fill: var(--accent); }
  .failed { fill: var(--danger); }
  .cursor { stroke: var(--text); stroke-width: 1.5; }
  .hover { stroke: var(--muted); stroke-dasharray: 2 2; pointer-events: none; }
  .hover-label { font-size: 11px; fill: var(--text); pointer-events: none; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); margin-top: 4px; }
  .legend .hint { margin-left: auto; }
  .sw { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: -1px; border-radius: 2px; }
  .sw.reviewed { background: var(--accent-soft); }
  .sw.dot { border-radius: 50%; }
  .sw.uploaded { background: var(--ok); }
  .sw.dry-run { background: var(--muted); }
  .sw.uploading { background: var(--accent); }
  .sw.failed { background: var(--danger); }
</style>

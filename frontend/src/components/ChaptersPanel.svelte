<script>
  // YouTube chapter titles from settled identifications (SPEC §12).
  import { api } from "../lib/api.js";

  let { video, settings, me } = $props();
  let opts = $state({ first_title: "Descent", research_only: false, include_unidentified: true, links: true });
  let result = $state(null);
  let error = $state(null);
  let loading = $state(false);
  let copied = $state(false);

  async function generate() {
    loading = true; error = null; copied = false;
    try {
      const items = video.observations
        .filter((o) => o.inat_id)
        .map((o) => ({ observation_id: o.inat_id, video_time: o.t_vid }));
      result = await api.chapters({ video_id: video.videoId, items, user_id: items.length ? null : me?.id ?? null,
                                    lead_in: settings.lead_in, ...opts });
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
  async function copy() {
    await navigator.clipboard.writeText(result.text);
    copied = true;
  }
</script>

<section>
  <p class="small">Best done a few days after uploading, once identifications have settled. Uses the observations saved in this
    browser; if there are none, it searches iNaturalist for observations that link to this video.</p>
  <div class="opts">
    <label>First chapter <input bind:value={opts.first_title} /></label>
    <label class="check"><input type="checkbox" bind:checked={opts.research_only} /> Research grade only</label>
    <label class="check"><input type="checkbox" bind:checked={opts.include_unidentified} /> Include unidentified</label>
    <label class="check"><input type="checkbox" bind:checked={opts.links} /> iNaturalist links</label>
    <button class="primary" onclick={generate} disabled={loading}>{loading ? "Fetching…" : "Generate chapters"}</button>
  </div>
  {#if error}<p class="warn">{error}</p>{/if}
  {#if result}
    {#each result.warnings as w}<p class="warn small">{w}</p>{/each}
    <p class="small muted">From {result.observations.length} observation{result.observations.length === 1 ? "" : "s"} ({result.source === "search" ? "found by searching iNat" : "saved in this browser"}).
      Paste this into the video's description on YouTube{video.observations.length ? "" : " (only the owner can)"}.</p>
    <textarea readonly rows={Math.min(16, result.chapters.length + 1)}>{result.text}</textarea>
    <button onclick={copy}>{copied ? "Copied" : "Copy"}</button>
  {/if}
</section>

<style>
  .opts { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 8px; }
  label { font-size: 13px; }
  .check { display: flex; gap: 6px; align-items: center; }
  textarea { width: 100%; font-family: var(--mono); font-size: 13px; }
  .small { font-size: 12px; }
</style>

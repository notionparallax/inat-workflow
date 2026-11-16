<script>
  // Setup (SPEC §14): video, dive log, token, extension, permission.
  import { clock } from "../lib/dive.js";

  let { video, videoInput = $bindable(""), me, meError, extension, playing, onVideo, onDiveFile, onToken,
        onPermission, onLicence, onClearSync, onPickDive, diveChoices = [] } = $props();

  let tokenInput = $state("");
  const LICENCES = ["CC0", "CC-BY", "CC-BY-NC", "CC-BY-SA", "CC-BY-ND", "CC-BY-NC-SA", "CC-BY-NC-ND"];
  const dive = $derived(video?.dive);
</script>

<section class="setup">
  <div class="step">
    <h3>1. Video</h3>
    <form onsubmit={(e) => { e.preventDefault(); onVideo(videoInput); }}>
      <input placeholder="YouTube link or video ID" bind:value={videoInput} />
      <button class="primary">Load</button>
    </form>
    <p class="muted small">The video must be public or unlisted, with embedding allowed.</p>
  </div>

  <div class="step">
    <h3>2. Dive log</h3>
    <input type="file" accept=".ssrf,.xml" onchange={(e) => e.currentTarget.files[0] && onDiveFile(e.currentTarget.files[0])} />
    {#if diveChoices.length > 1}
      <p>This file has {diveChoices.length} dives. Which one matches the video?</p>
      {#each diveChoices as d, i}
        <button onclick={() => onPickDive(i)}>Dive {d.number ?? i + 1} · {d.start_local}</button>
      {/each}
    {/if}
    {#if dive}
      <dl>
        <dt>Dive</dt><dd>{dive.number ? `#${dive.number}, ` : ""}{dive.site?.name || "unnamed site"}</dd>
        <dt>Start</dt><dd>{dive.start_local?.replace("T", " ")} {dive.timezone ? `(${dive.timezone}, UTC${dive.utc_offset})` : ""}</dd>
        <dt>Length</dt><dd>{clock(dive.duration_s)} · max {dive.max_depth} m · samples every {dive.sample_interval_s} s</dd>
        <dt>Location</dt>
        <dd>
          {#if dive.location}
            {dive.location.lat.toFixed(5)}, {dive.location.lon.toFixed(5)} ({dive.location.source})
          {:else}
            <span class="warn">No GPS fix in this log. Observations will upload without a location; set it on iNaturalist afterwards.</span>
          {/if}
        </dd>
      </dl>
      <h4>Sync</h4>
      <p class="small">Pause on the frame where you go under and press <kbd>D</kbd>; on the frame where you surface, press <kbd>A</kbd>.
        If the video starts or ends mid-dive, set one and drag the profile to line it up.</p>
      <dl>
        <dt>Descent</dt><dd>{video.sync.descentVid != null ? `video ${clock(video.sync.descentVid)} = log ${clock(dive.descent_s)}` : "not set"}</dd>
        <dt>Ascent</dt><dd>{video.sync.ascentVid != null ? `video ${clock(video.sync.ascentVid)} = log ${clock(dive.ascent_s)}` : "not set"}</dd>
        <dt>Dragged</dt><dd>{(video.sync.dragOffset || 0).toFixed(1)} s</dd>
      </dl>
      <button onclick={onClearSync}>Reset sync</button>
    {/if}
  </div>

  <div class="step">
    <h3>3. iNaturalist login</h3>
    {#if me}
      <p>Logged in as <strong>{me.login}</strong>{me.name ? ` (${me.name})` : ""}.</p>
    {:else}
      {#if meError}<p class="warn small">{meError}</p>{/if}
      <p class="small">Get a token from <a href="https://www.inaturalist.org/users/api_token" target="_blank" rel="noreferrer">inaturalist.org/users/api_token</a>
        (tokens last 24 hours) and paste it here.</p>
    {/if}
    <form onsubmit={(e) => { e.preventDefault(); onToken(tokenInput); tokenInput = ""; }}>
      <input placeholder="Paste API token" bind:value={tokenInput} />
      <button>{me ? "Replace" : "Save"}</button>
    </form>
  </div>

  <div class="step">
    <h3>4. Frame grabber extension</h3>
    {#if extension.found}
      <p>Installed (v{extension.version}).
        {#if extension.height}Playing at {extension.width}×{extension.height}{extension.fps ? `, ≈${extension.fps} fps` : ""}.{/if}</p>
      {#if extension.height && extension.height < 2160}
        <p class="warn small">Not playing at 2160p. Choose the highest quality in the player's settings menu, or ask the player for it:</p>
      {/if}
      <button onclick={extension.requestQuality}>Ask player for 2160p</button>
      {#if extension.qualityNote}<p class="small muted">{extension.qualityNote}</p>{/if}
    {:else}
      <p class="warn small">Not detected{playing ? "" : " yet (start the video)"}. Install it from the <code>extension</code> folder: open
        <code>chrome://extensions</code>, turn on Developer mode, choose “Load unpacked” and pick the folder, then reload this page.</p>
    {/if}
  </div>

  <div class="step">
    <h3>5. Permission</h3>
    <label>Licence the video owner agreed to
      <select value={video?.permission.licence} onchange={(e) => onLicence(e.currentTarget.value)} disabled={!video}>
        {#each LICENCES as l}<option>{l}</option>{/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" checked={video?.permission.granted} disabled={!video} onchange={(e) => onPermission(e.currentTarget.checked)} />
      I have explicit permission from the owner of this video to create iNaturalist observations from it, and to
      release its frames under the licence selected.
    </label>
  </div>
</section>

<style>
  .setup { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .step { border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; background: var(--surface); }
  h3 { margin: 0 0 8px; font-size: 14px; }
  h4 { margin: 10px 0 4px; font-size: 13px; }
  form { display: flex; gap: 6px; }
  form input { flex: 1; min-width: 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 13px; margin: 8px 0; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; margin-top: 8px; }
  label { font-size: 13px; display: block; }
  select { margin-left: 6px; }
  .small { font-size: 12px; }
</style>

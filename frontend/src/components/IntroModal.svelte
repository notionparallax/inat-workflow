<script>
  // First-visit introduction: what the tool does, and what to install.
  import { EXTENSION_STORE_URL, EXTENSION_ZIP_URL, REPO_URL } from "../lib/config.js";

  let { extension, onClose } = $props();
  let dialog;
  $effect(() => { dialog?.showModal(); });
  const isChrome = typeof navigator !== "undefined" && !!navigator.userAgentData?.brands?.some((b) => b.brand === "Google Chrome" || b.brand === "Chromium");
</script>

<dialog bind:this={dialog} class="intro" onclose={onClose} aria-labelledby="intro-title">
  <header>
    <img src="favicon.svg" alt="" width="40" height="40" />
    <div>
      <h2 id="intro-title">Dive iNat</h2>
      <p class="muted">Turn a dive video and your dive log into iNaturalist observations.</p>
    </div>
  </header>

  <ol class="how">
    <li><strong>Load</strong> a YouTube dive video and the <code>.ssrf</code> log from Subsurface, then line the two up.</li>
    <li><strong>Watch</strong> and press <kbd>M</kbd> when you see something. Pick the sharpest frames, mark the organism, crop or make a GIF.</li>
    <li><strong>Upload.</strong> Time, depth, temperature and location come from the dive log; the identification happens on iNaturalist.</li>
  </ol>

  <section class="install" class:done={extension.found}>
    <h3>{extension.found ? "✓ Frame grabber extension installed" : "First, install the frame grabber extension"}</h3>
    {#if !extension.found}
      <p>Browsers don't let a web page read pictures out of a YouTube player. The small Chrome extension does that, and only
        inside the player on this site. It sees nothing else you do.</p>
      {#if !isChrome}<p class="warn">It needs desktop Chrome (or another Chromium browser, such as Edge or Brave).</p>{/if}
      {#if EXTENSION_STORE_URL}
        <p><a class="button primary" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">Add to Chrome</a>
          then reload this page.</p>
      {:else}
        <ol>
          <li><a href={EXTENSION_ZIP_URL} download>Download the extension</a> and unzip it somewhere it can stay.</li>
          <li>Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> (top right).</li>
          <li>Click <strong>Load unpacked</strong> and choose the unzipped folder.</li>
          <li>Reload this page.</li>
        </ol>
        <p class="muted small">It will be in the Chrome Web Store soon, which makes this one click.</p>
      {/if}
      <p class="muted small">Once a video is loaded, the “No extension” label at the top turns green when the extension is found.</p>
    {/if}
  </section>

  <section>
    <h3>You'll also need</h3>
    <ul>
      <li>An <a href="https://www.inaturalist.org" target="_blank" rel="noreferrer">iNaturalist</a> account. You paste a login token in Setup; it lasts 24 hours.</li>
      <li>A dive log from <a href="https://subsurface-divelog.org" target="_blank" rel="noreferrer">Subsurface</a> (File → Export → Subsurface XML).</li>
      <li>The video owner's permission to put their frames on iNaturalist under your photo licence. Your own videos are fine.</li>
    </ul>
  </section>

  <p class="muted small">Everything runs in your browser. Your token, logs and frames go only to iNaturalist, never to us: there is no server.
    Uploads start in <strong>dry-run</strong> mode, which shows what would be sent; turn it off in Settings.
    <a href="privacy.html" target="_blank">Privacy</a> · <a href={REPO_URL} target="_blank" rel="noreferrer">Source and feedback</a>.</p>

  <footer>
    <form method="dialog"><button class="primary">Get started</button></form>
  </footer>
</dialog>

<style>
  .intro { max-width: 640px; width: calc(100% - 32px); border: 1px solid var(--border); border-radius: 10px;
           background: var(--surface); color: var(--text); padding: 20px 24px; }
  .intro::backdrop { background: rgb(5 20 30 / 0.6); }
  header { display: flex; gap: 12px; align-items: center; }
  h2 { margin: 0; font-size: 20px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  header p { margin: 2px 0 0; }
  .how { padding-left: 20px; margin: 14px 0; }
  .how li { margin-bottom: 4px; }
  section { margin: 14px 0; }
  ul, section ol { padding-left: 20px; margin: 6px 0; }
  .install { border: 1px solid var(--accent); border-radius: 8px; padding: 10px 14px; background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .install.done { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 8%, transparent); }
  .install p { margin: 6px 0; }
  .button { display: inline-block; padding: 5px 14px; border-radius: 5px; text-decoration: none; }
  .button.primary { background: var(--accent); color: #fff; }
  .warn { color: var(--warn); }
  .muted { color: var(--muted); }
  .small { font-size: 12px; }
  footer { display: flex; justify-content: flex-end; margin-top: 8px; }
</style>

<script>
  // Capturer settings (SPEC §6.3).
  let { settings, onChange } = $props();
  const set = (key, value) => onChange({ ...settings, [key]: value });
  const num = (v) => (v === "" || v == null ? null : Number(v));
</script>

<section class="settings">
  <label>Observer (the diver)<input value={settings.observer} oninput={(e) => set("observer", e.currentTarget.value)} /></label>
  <label>Frames captured by<input value={settings.capturer} oninput={(e) => set("capturer", e.currentTarget.value)} placeholder="Defaults to your iNat login" /></label>
  <label>Location accuracy (m)<input type="number" min="1" value={settings.accuracy_m} oninput={(e) => set("accuracy_m", num(e.currentTarget.value))} /></label>
  <label>Depth observation field ID<input type="number" value={settings.depth_field_id ?? ""} oninput={(e) => set("depth_field_id", num(e.currentTarget.value))} />
    <small>558 = “Depth (m)”, numeric, the most used depth field (≈46,000 uses)</small></label>
  <label>Water temperature observation field ID<input type="number" value={settings.temp_field_id ?? ""} oninput={(e) => set("temp_field_id", num(e.currentTarget.value))} />
    <small>No clear standard. Candidates: 14913 “Water temperature (in °C)” numeric; 1661 “Water temperature (C)” text. Ask the scientist.</small></label>
  <label>iNat project ID (optional)<input type="number" value={settings.project_id ?? ""} oninput={(e) => set("project_id", num(e.currentTarget.value))} />
    <small>Leave empty if the project collects observations by area automatically.</small></label>
  <label class="wide">Text added to every observation's notes<textarea rows="2" value={settings.free_text} oninput={(e) => set("free_text", e.currentTarget.value)}></textarea></label>
  <label>Detail crop width (px)<input type="number" value={settings.crop_w} oninput={(e) => set("crop_w", num(e.currentTarget.value))} /></label>
  <label>Detail crop height (px)<input type="number" value={settings.crop_h} oninput={(e) => set("crop_h", num(e.currentTarget.value))} /></label>
  <label>Burst: seconds before mark<input type="number" step="0.1" min="0" value={settings.burst_before} oninput={(e) => set("burst_before", num(e.currentTarget.value))} /></label>
  <label>Burst: seconds after mark<input type="number" step="0.1" min="0" value={settings.burst_after} oninput={(e) => set("burst_after", num(e.currentTarget.value))} /></label>
  <label class="check wide"><input type="checkbox" checked={settings.dry_run} onchange={(e) => set("dry_run", e.currentTarget.checked)} />
    Dry run: show what would be sent to iNaturalist without uploading</label>
</section>

<style>
  .settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px 16px; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
  label.check { flex-direction: row; align-items: center; gap: 8px; }
  .wide { grid-column: 1 / -1; }
  small { color: var(--muted); font-size: 11px; }
</style>

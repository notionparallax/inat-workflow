// Runs in the YouTube embed page's own JavaScript context, so it can ask the
// player for a playback quality. Unofficial player API: best effort only.
(() => {
  "use strict";
  const allowed = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const parent = location.ancestorOrigins && location.ancestorOrigins[0];
  if (!parent || !allowed.test(parent)) return;

  window.addEventListener("dive-inat-quality", (e) => {
    let reply;
    try {
      const { level } = JSON.parse(e.detail || "{}");
      const player = document.getElementById("movie_player");
      const available = (player && player.getAvailableQualityLevels && player.getAvailableQualityLevels()) || [];
      const target = available.includes(level) ? level : available[0];
      if (player && target) {
        if (player.setPlaybackQualityRange) player.setPlaybackQualityRange(target, target);
        if (player.setPlaybackQuality) player.setPlaybackQuality(target);
      }
      reply = { ok: !!target, requested: level, set: target || null, available };
    } catch (err) {
      reply = { ok: false, error: String(err) };
    }
    window.dispatchEvent(new CustomEvent("dive-inat-quality-reply", { detail: JSON.stringify(reply) }));
  });
})();

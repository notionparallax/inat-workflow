// TEMPORARY, for development: hard-coded values so the tool starts ready to
// use after every change. Set `enabled` to false to turn this off.
export const DEV_DEFAULTS = {
  enabled: true,
  videoUrl: "https://www.youtube.com/watch?v=MRja6VhCmMs",
  // Served by Vite from frontend/public/dev/.
  diveFile: "/dev/gordons_dive.ssrf",
  permission: { granted: true, licence: "CC0" },
  settings: { observer: "Ben Doherty" },
};

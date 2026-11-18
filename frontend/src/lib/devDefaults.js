// Development only (`npm run dev`, never in the built site): hard-coded values
// so the tool starts ready to use after every change. Set `enabled` to false
// to turn this off.
export const DEV_DEFAULTS = {
  enabled: true,
  videoUrl: "https://www.youtube.com/watch?v=MRja6VhCmMs",
  // The dive log is the test fixture, frontend/test/fixtures/gordons_dive.ssrf.
  // Permission is granted automatically, for the account's photo licence.
  settings: { observer: "Ben Doherty" },
};

// Saved state (SPEC §11): settings, and per-video work keyed by YouTube ID.
// Frame images live only in memory for now (not IndexedDB yet).

const SETTINGS_KEY = "dive-inat:settings";
const videoKey = (id) => `dive-inat:video:${id}`;

export const DEFAULT_SETTINGS = {
  observer: "",
  capturer: "",
  accuracy_m: 150,
  depth_field_id: 558, // "Depth (m)", numeric, the most used depth field on iNat
  temp_field_id: null, // for the scientist to choose (SPEC §9.4)
  project_id: null,
  free_text: "",
  crop_w: 1600,
  crop_h: 1200,
  burst_before: 0.5,
  burst_after: 0.5,
  dry_run: true,
  lead_in: 2,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked: work continues unsaved */ }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}
export const saveSettings = (s) => write(SETTINGS_KEY, s);

export function emptyVideoState(videoId) {
  return {
    videoId,
    dive: null,
    diveFile: null,
    sync: { descentVid: null, ascentVid: null, dragOffset: 0 },
    permission: { granted: false, licence: "CC0" },
    observations: [],
    reviewed: [],
  };
}

export function loadVideoState(videoId) {
  return { ...emptyVideoState(videoId), ...read(videoKey(videoId), {}) };
}
export const saveVideoState = (state) => write(videoKey(state.videoId), state);

export const LAST_VIDEO_KEY = "dive-inat:last-video";
export const loadLastVideo = () => read(LAST_VIDEO_KEY, null);
export const saveLastVideo = (id) => write(LAST_VIDEO_KEY, id);

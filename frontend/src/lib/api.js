// Everything that used to be the Python back end, now in the browser: dive log
// parsing, building observations and talking to iNaturalist directly.
// Errors carry `status` and a `body` of {error, status, body, progress}, as before.

import { buildChapters, videoTimeFromDescription } from "./chapters.js";
import { observationValues } from "./dive.js";
import { buildObservationPayload, Client, INatError, tokenExpiry } from "./inat.js";
import { buildDescription } from "./notes.js";
import { parseSsrf } from "./ssrf.js";

const TOKEN_KEY = "dive-inat:token";

function readToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    const exp = t && tokenExpiry(t);
    if (exp && exp * 1000 < Date.now()) { localStorage.removeItem(TOKEN_KEY); return null; }
    return t;
  } catch { return null; }
}
function writeToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* blocked */ }
}

const client = new Client({ token: readToken() });
let termsCache = null;

function fail(message, status, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.body = { error: message, status, ...extra };
  return err;
}
const fromINat = (e, extra = {}) =>
  e instanceof INatError ? fail(e.message, 502, { status: e.status, body: e.body, ...extra }) : e;

async function me() {
  if (!client.token) throw fail("No token set", 401);
  let user;
  try {
    user = await client.me();
  } catch (e) {
    if (e.status === 401) throw fail("Token rejected or expired", 401);
    throw fromINat(e);
  }
  const expires = tokenExpiry(client.token);
  return {
    id: user.id, login: user.login, name: user.name, time_zone: user.time_zone,
    observation_licence: user.preferred_observation_license, photo_licence: user.preferred_photo_license,
    token_expires_at: expires, token_expires_in_s: expires ? expires - Math.floor(Date.now() / 1000) : null,
  };
}

async function setToken(raw) {
  let token = raw.trim();
  if (token.startsWith("{")) { // pasted the whole {"api_token": "..."} response
    try { token = JSON.parse(token).api_token; } catch { token = null; }
    if (!token) throw fail("That doesn't look like an iNaturalist API token.", 400);
  }
  client.token = token;
  try {
    const user = await me();
    writeToken(token);
    return user;
  } catch (e) {
    if (e.status === 401) { client.token = null; writeToken(null); }
    throw e;
  }
}

async function parseDive(file) {
  let dives;
  try {
    dives = parseSsrf(await file.text());
  } catch (e) {
    throw fail(e.message, 400);
  }
  if (!dives.length) throw fail("No dives found in that file.", 400);
  return { dives };
}

async function terms() {
  if (!termsCache) {
    try {
      const raw = await client.controlledTerms();
      termsCache = raw.map((t) => ({
        id: t.id, label: t.label, multivalued: t.multivalued || false, taxon_ids: t.taxon_ids || [],
        values: t.values.map((v) => ({ id: v.id, label: v.label })),
      }));
    } catch (e) { throw fromINat(e); }
  }
  return { terms: termsCache };
}

/** Create an observation, add photos, annotations and project. `meta.resume`
 *  picks up a failed upload where it stopped. */
async function upload(m, photos) {
  if (!m.permission) throw fail("Confirm you have the video owner's permission before uploading.", 400);
  const dive = m.dive || null;
  const settings = m.settings || {};
  const values = dive ? observationValues(dive, Number(m.t_log), m.utc_offset) : {};
  const location = dive?.location || null;
  const description = buildDescription({
    video_id: m.video_id, t_vid: Number(m.t_vid), values, site_name: dive?.site?.name,
    location_source: location?.source, positions: m.positions || [], crop_of: m.crop_of || [],
    observer: settings.observer, capturer: settings.capturer, free_text: settings.free_text, has_gif: !!m.has_gif,
  });
  const field_values = {};
  if (settings.depth_field_id && values.depth_m != null) field_values[settings.depth_field_id] = values.depth_m;
  if (settings.temp_field_id && values.temp_c != null) field_values[settings.temp_field_id] = values.temp_c;
  const payload = buildObservationPayload({
    observed_on: values.observed_on, time_zone: m.time_zone || dive?.timezone, location,
    accuracy_m: settings.accuracy_m, description, licence: m.licence, field_values,
  });
  const annotations = m.annotations || [];

  if (m.dry_run ?? true) {
    return { dry_run: true, payload, values, annotations, project_id: settings.project_id,
             photos: photos.map((p) => ({ filename: p.filename, bytes: p.blob.size, type: p.blob.type || "image/jpeg" })) };
  }

  const progress = { photos_done: 0, annotations_done: 0, dropped_annotations: [], ...(m.resume || {}) };
  try {
    if (!progress.observation_id) {
      const obs = await client.createObservation(payload);
      progress.observation_id = obs.id;
      progress.uuid = obs.uuid;
    }
    for (let i = progress.photos_done; i < photos.length; i++) {
      await client.addPhoto(progress.observation_id, photos[i].blob, photos[i].filename);
      progress.photos_done = i + 1;
    }
    for (let i = progress.annotations_done; i < annotations.length; i++) {
      const a = annotations[i];
      try {
        await client.addAnnotation(progress.uuid, Number(a.attribute_id), Number(a.value_id));
      } catch (e) {
        if (!(e instanceof INatError) || ![400, 422].includes(e.status)) throw e;
        // iNat rejects annotations that don't apply (e.g. taxon-limited ones).
        progress.dropped_annotations.push({ ...a, reason: JSON.stringify(e.body) });
      }
      progress.annotations_done = i + 1;
    }
    if (settings.project_id && !progress.project_done) {
      try {
        await client.addToProject(Number(settings.project_id), progress.observation_id);
      } catch (e) {
        if (!(e instanceof INatError) || ![400, 422].includes(e.status)) throw e;
        progress.project_error = JSON.stringify(e.body);
      }
      progress.project_done = true;
    }
  } catch (e) {
    throw fromINat(e, { progress });
  }
  return { dry_run: false, observation_id: progress.observation_id,
           url: `https://www.inaturalist.org/observations/${progress.observation_id}`,
           has_location: !!location, progress };
}

async function chapters(body) {
  const { video_id, items = [], search_if_empty = true, user_id = null, lead_in = 2, first_title = "Descent",
          research_only = false, include_unidentified = true } = body;
  let found, source;
  try {
    if (items.length) {
      const byId = new Map((await client.observations(items.map((i) => i.observation_id))).map((o) => [o.id, o]));
      found = items.filter((i) => byId.has(i.observation_id))
        .map((i) => ({ video_time: i.video_time, observation: byId.get(i.observation_id) }));
      source = "saved";
    } else if (search_if_empty) {
      found = [];
      for (const o of await client.searchVideo(video_id, user_id)) {
        const t = videoTimeFromDescription(o.description, video_id);
        if (t != null) found.push({ video_time: t, observation: o });
      }
      source = "search";
    } else {
      found = [];
      source = "none";
    }
  } catch (e) { throw fromINat(e); }
  const result = buildChapters(found, { lead_in, first_title, research_only, include_unidentified });
  result.source = source;
  result.observations = found.map((i) => ({
    id: i.observation.id, video_time: i.video_time, quality_grade: i.observation.quality_grade, taxon: i.observation.taxon?.name ?? null,
  }));
  return result;
}

export const api = {
  me,
  setToken,
  logout: () => { client.token = null; writeToken(null); },
  parseDive,
  terms,
  upload,
  chapters,
};

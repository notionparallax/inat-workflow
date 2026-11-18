// Thin iNaturalist API v1 client and payload builder (SPEC §9.2, §10).
// Runs in the browser: the API allows cross-origin requests.

export const API = "https://api.inaturalist.org/v1";

export class INatError extends Error {
  constructor(message, status = null, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** The JSON body for POST /observations. No taxon: identification happens on iNat. */
export function buildObservationPayload({ observed_on, time_zone, location, accuracy_m, description, licence, field_values = {} }) {
  const obs = { description };
  if (observed_on) obs.observed_on_string = observed_on;
  if (time_zone) obs.time_zone = time_zone;
  if (location) {
    obs.latitude = location.lat;
    obs.longitude = location.lon;
    if (accuracy_m) obs.positional_accuracy = accuracy_m;
  }
  if (licence) obs.license = licence;
  const ofvs = Object.entries(field_values)
    .filter(([fid, value]) => Number(fid) && value != null)
    .map(([fid, value]) => ({ observation_field_id: Number(fid), value }));
  if (ofvs.length) obs.observation_field_values_attributes = ofvs;
  return { observation: obs };
}

/** Expiry time (Unix seconds) from a JWT's payload, if readable. */
export function tokenExpiry(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(payload + "=".repeat((4 - (payload.length % 4)) % 4))).exp;
    return Number.isFinite(exp) ? Math.trunc(exp) : null;
  } catch {
    return null;
  }
}

const realSleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// Statuses where iNat hasn't acted on the request, so even a POST is safe to repeat.
const NOT_PROCESSED = new Set([429, 503]);

/** Minimal client with throttling (≈1 request/s, iNat's guideline) and retries.
 *  GETs are retried on network errors, 429 and 5xx. Writes are retried only on
 *  429 and 503: after a lost response or a 500/502/504 the write may already
 *  have happened, and repeating it could make a duplicate observation. */
export class Client {
  constructor({ token = null, minInterval = 1, retries = 3, timeoutS = 120, fetch: f = (...a) => globalThis.fetch(...a), sleep = realSleep } = {}) {
    this.timeoutS = timeoutS;
    this.token = token;
    this.minInterval = minInterval;
    this.retries = retries;
    this._fetch = f;
    this._sleep = sleep;
    this._last = 0;
    this._queue = Promise.resolve();
  }

  /** Requests run one at a time, so the throttle holds across callers. */
  request(method, path, opts = {}) {
    const run = this._queue.then(() => this._request(method, path, opts));
    this._queue = run.catch(() => {});
    return run;
  }

  async _request(method, path, { auth = false, json, form, params } = {}) {
    const headers = {};
    if (auth) {
      if (!this.token) throw new INatError("No iNaturalist API token set", 401);
      headers.Authorization = this.token;
    }
    let body;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, v);

    let attempt = 0;
    for (;;) {
      const wait = this.minInterval - (Date.now() - this._last) / 1000;
      if (wait > 0) await this._sleep(wait);
      this._last = Date.now();
      const safe = method === "GET";
      let resp;
      try {
        // A stalled request would otherwise hold up every later one in the queue.
        resp = await this._fetch(url.toString(), { method, headers, body, signal: AbortSignal.timeout(this.timeoutS * 1000) });
      } catch (e) {
        if (safe && attempt < this.retries) { attempt++; await this._sleep(2 ** attempt); continue; }
        const what = e.name === "TimeoutError" ? `no answer after ${this.timeoutS} s` : e.message;
        throw new INatError(`Network error talking to iNaturalist: ${what}`);
      }
      if ((NOT_PROCESSED.has(resp.status) || (safe && resp.status >= 500)) && attempt < this.retries) {
        attempt++;
        await this._sleep(2 ** attempt);
        continue;
      }
      const text = await resp.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (resp.status >= 400) throw new INatError(`iNaturalist returned ${resp.status} for ${method} ${path}`, resp.status, data);
      return data;
    }
  }

  // --- Reads (no login needed unless noted) ---------------------------------
  me() { return this.request("GET", "/users/me", { auth: true }).then((r) => r.results[0]); }
  controlledTerms() { return this.request("GET", "/controlled_terms").then((r) => r.results); }
  observations(ids) {
    if (!ids.length) return Promise.resolve([]);
    return this.request("GET", "/observations", { params: { id: ids.join(","), per_page: 200 } }).then((r) => r.results);
  }
  searchVideo(videoId, userId = null) {
    return this.request("GET", "/observations", { params: { q: videoId, search_on: "description", per_page: 200, user_id: userId } })
      .then((r) => r.results);
  }

  // --- Writes ------------------------------------------------------------------
  async createObservation(payload) {
    const result = await this.request("POST", "/observations", { auth: true, json: payload });
    return Array.isArray(result) ? result[0] : result;
  }
  addPhoto(observationId, blob, filename) {
    const form = new FormData();
    form.append("observation_photo[observation_id]", String(observationId));
    form.append("file", blob, filename);
    return this.request("POST", "/observation_photos", { auth: true, form });
  }
  addAnnotation(observationUuid, attributeId, valueId) {
    return this.request("POST", "/annotations", { auth: true, json: { annotation: {
      resource_type: "Observation", resource_id: observationUuid,
      controlled_attribute_id: attributeId, controlled_value_id: valueId,
    } } });
  }
  addToProject(projectId, observationId) {
    return this.request("POST", "/project_observations", { auth: true, json: {
      project_observation: { project_id: projectId, observation_id: observationId } } });
  }
}

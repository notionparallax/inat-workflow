// Calls to the local Python back end.

async function json(resp) {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(body.detail || body.error || `Request failed (${resp.status})`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  health: () => fetch("/api/health").then(json),
  me: () => fetch("/api/me").then(json),
  setToken: (token) =>
    fetch("/api/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then(json),
  parseDive: (file) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/dive", { method: "POST", body: form }).then(json);
  },
  terms: () => fetch("/api/controlled-terms").then(json),
  upload: (meta, photos) => {
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    for (const p of photos) form.append("photos", p.blob, p.filename);
    return fetch("/api/observations", { method: "POST", body: form }).then(json);
  },
  chapters: (body) =>
    fetch("/api/chapters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json),
};

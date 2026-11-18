// YouTube chapter titles from settled iNat identifications (SPEC §12).

export const MIN_CHAPTER_S = 10;
const T_PARAM = /youtu\.be\/([A-Za-z0-9_-]{11})\?t=(\d+)/g;

/** Recover the video time from the link written into the notes. */
export function videoTimeFromDescription(description, videoId) {
  for (const [, vid, t] of (description || "").matchAll(T_PARAM)) {
    if (vid === videoId) return Number(t);
  }
  return null;
}

export function taxonTitle(obs, unidentified) {
  const taxon = obs.taxon;
  if (!taxon) return unidentified;
  const common = taxon.preferred_common_name;
  if (common) return `${common[0].toUpperCase()}${common.slice(1)} (${taxon.name})`;
  return taxon.name;
}

export function formatTs(seconds, withHours) {
  const total = Math.trunc(seconds);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), r = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return withHours ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

// The short form (it redirects to www.) saves room in the 5,000-character description.
export const observationUrl = (id) => `https://inaturalist.org/observations/${id}`;
export const DESCRIPTION_LIMIT = 5000;

/** `items` are {video_time, observation}. Returns {chapters: [{t, title}], text, warnings}.
 *  With `links`, each name is followed by its observations' iNaturalist links. */
export function buildChapters(items, {
  lead_in = 2, first_title = "Descent", research_only = false, include_unidentified = true,
  unidentified_title = "Unidentified – see iNaturalist", links = false,
} = {}) {
  const entries = [];
  for (const item of items) {
    const obs = item.observation;
    if (research_only && obs.quality_grade !== "research") continue;
    if (!obs.taxon && !include_unidentified) continue;
    entries.push([Math.max(0, Math.trunc(item.video_time) - lead_in), taxonTitle(obs, unidentified_title), obs.id]);
  }
  entries.sort((a, b) => a[0] - b[0]);

  // Each chapter holds names in order, each with the observations that gave it.
  const chapters = [{ t: 0, names: [{ name: first_title, ids: [] }] }];
  for (const [t, name, id] of entries) {
    const last = chapters[chapters.length - 1];
    if (t - last.t < MIN_CHAPTER_S) {
      const same = last.names.find((n) => n.name === name);
      if (last.t === 0 && last.names.length === 1 && last.names[0].name === first_title && !last.names[0].ids.length) {
        last.names = [{ name, ids: [id] }]; // too close to the start for its own chapter: replace "Descent"
      } else if (same) {
        same.ids.push(id);
      } else {
        last.names.push({ name, ids: [id] });
      }
    } else {
      chapters.push({ t, names: [{ name, ids: [id] }] });
    }
  }
  for (const c of chapters) {
    c.titles = c.names.map((n) => (links && n.ids.length ? [n.name, ...n.ids.filter((x) => x != null).map(observationUrl)].join(" ") : n.name));
  }

  const warnings = [];
  if (chapters.length < 3) warnings.push("YouTube needs at least three chapters; these won't show as chapters yet.");
  const withHours = chapters.some((c) => c.t >= 3600);
  const out = chapters.map((c) => ({ t: c.t, title: c.titles.join(" / ") }));
  const text = out.map((c) => `${c.t === 0 && !withHours ? "00:00" : formatTs(c.t, withHours)} ${c.title}`).join("\n");
  if (text.length > DESCRIPTION_LIMIT * 0.8) {
    warnings.push(`These chapters are ${text.length.toLocaleString("en")} characters, and a YouTube description can hold ${DESCRIPTION_LIMIT.toLocaleString("en")} in all.` +
                  (links ? " Turning off the iNaturalist links makes them much shorter." : ""));
  }
  return { chapters: out, text, warnings };
}

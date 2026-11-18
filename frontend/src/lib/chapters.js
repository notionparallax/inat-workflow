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

/** `items` are {video_time, observation}. Returns {chapters: [{t, title}], text, warnings}. */
export function buildChapters(items, {
  lead_in = 2, first_title = "Descent", research_only = false, include_unidentified = true,
  unidentified_title = "Unidentified – see iNaturalist",
} = {}) {
  const entries = [];
  for (const item of items) {
    const obs = item.observation;
    if (research_only && obs.quality_grade !== "research") continue;
    if (!obs.taxon && !include_unidentified) continue;
    entries.push([Math.max(0, Math.trunc(item.video_time) - lead_in), taxonTitle(obs, unidentified_title)]);
  }
  entries.sort((a, b) => a[0] - b[0]);

  const chapters = [{ t: 0, titles: [first_title] }];
  for (const [t, title] of entries) {
    const last = chapters[chapters.length - 1];
    if (t - last.t < MIN_CHAPTER_S) {
      if (last.t === 0 && last.titles.length === 1 && last.titles[0] === first_title) {
        last.titles = [title]; // too close to the start for its own chapter: replace "Descent"
      } else if (!last.titles.includes(title)) {
        last.titles.push(title);
      }
    } else {
      chapters.push({ t, titles: [title] });
    }
  }

  const warnings = [];
  if (chapters.length < 3) warnings.push("YouTube needs at least three chapters; these won't show as chapters yet.");
  const withHours = chapters.some((c) => c.t >= 3600);
  const out = chapters.map((c) => ({ t: c.t, title: c.titles.join(" / ") }));
  const text = out.map((c) => `${c.t === 0 && !withHours ? "00:00" : formatTs(c.t, withHours)} ${c.title}`).join("\n");
  return { chapters: out, text, warnings };
}

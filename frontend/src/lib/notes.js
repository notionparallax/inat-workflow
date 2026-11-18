// Observation description (notes) template (SPEC §9.3).

import { region } from "./dive.js";

export const TOOL_NAME = "dive-inat";
export const TOOL_VERSION = "0.2.0";

export const youtubeLink = (videoId, tVid) => `https://youtu.be/${videoId}?t=${Math.trunc(tVid)}`;

const s = (n, one, many) => (n > 1 ? many : one);

/** Build the notes text.
 *  `positions[i]` is the subject point on still i (percent), or null.
 *  `crop_of[j]` is the still index (0-based) that detail crop j was cut from.
 *  Photo numbers in the text follow the upload order: GIF, stills, crops. */
export function buildDescription({
  video_id, t_vid, values = {}, site_name, location_source, positions = [], crop_of = [],
  observer, capturer, free_text, has_gif = false,
}) {
  const offset = has_gif ? 1 : 0;
  const lines = [`Video: ${youtubeLink(video_id, t_vid)}`];
  if (values.depth_m != null) lines.push(`Depth: ${values.depth_m.toFixed(1)} m (interpolated from dive computer log)`);
  if (values.temp_c != null) lines.push(`Water temperature: ${values.temp_c} °C (dive computer)`);
  if (site_name) lines.push(`Dive site: ${site_name}`);
  if (location_source) lines.push(`Location: dive entry point (${location_source} GPS), not the exact position of the organism`);
  if (values.dive_time) lines.push(`Time into dive: ${values.dive_time}`);

  const posParts = [];
  positions.forEach((p, i) => {
    if (!p) return;
    posParts.push(`photo ${i + 1 + offset} – ${Math.round(p.x)}% across, ${Math.round(p.y)}% down (${region(p.x, p.y)})`);
  });
  if (posParts.length) lines.push("Subject position: " + posParts.join("; "));

  if (crop_of.length) {
    const n = crop_of.length;
    const firstCrop = positions.length + 1 + offset;
    const cropNums = crop_of.map((_, j) => firstCrop + j);
    const sourceNums = crop_of.map((i) => i + 1 + offset);
    lines.push(`Photo${s(n, "", "s")} ${cropNums.join(", ")} ${s(n, "is a", "are")} full-resolution crop${s(n, "", "s")} ` +
               `of photo${s(n, "", "s")} ${sourceNums.join(", ")}.`);
  }
  if (has_gif) lines.push("Photo 1 is an animated GIF from the video.");

  const credit = [];
  if (observer) credit.push(`Observed by: ${observer}.`);
  if (capturer) credit.push(`Frames captured by: ${capturer}, with the video owner's permission.`);
  if (credit.length) lines.push(credit.join(" "));
  if (free_text && free_text.trim()) lines.push(free_text.trim());
  lines.push(`Created with ${TOOL_NAME} v${TOOL_VERSION}`);
  return lines.join("\n");
}

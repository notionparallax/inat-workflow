// Image helpers: crops cut from full-resolution frames (SPEC §9.9).

/** Cut `box` ({x, y, s} as fractions of the frame) out of the frame's JPEG. */
export async function cropFromBox(frame, box, quality = 0.92) {
  const bitmap = await createImageBitmap(frame.blob);
  const x = Math.round(box.x * bitmap.width), y = Math.round(box.y * bitmap.height);
  const w = Math.min(bitmap.width - x, Math.round(box.s * bitmap.width));
  const h = Math.min(bitmap.height - y, Math.round(box.s * bitmap.height));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

export const INAT_MAX_PX = 2048; // iNat stores photos at most this many px on the long edge

/** Frames already within iNat's size limit gain nothing from cropping. */
export const canCrop = (f) => Math.max(f.width, f.height) > INAT_MAX_PX;

/** Smallest crop box allowed: INAT_MAX_PX on the long edge, frame aspect ratio. */
export const minCropSize = (f) => Math.min(1, INAT_MAX_PX / Math.max(f.width, f.height));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Initial crop box: smallest allowed, centred on the subject if marked. */
export function defaultCropBox(f) {
  const s = minCropSize(f);
  const cx = f.position ? f.position.x / 100 : 0.5;
  const cy = f.position ? f.position.y / 100 : 0.5;
  return { x: clamp(cx - s / 2, 0, 1 - s), y: clamp(cy - s / 2, 0, 1 - s), s };
}

// Image helpers: detail crops cut from full-resolution frames (SPEC §9.9).
import { cropRect } from "./dive.js";

export async function makeCrop(frame, cropW, cropH, quality = 0.92) {
  const bitmap = await createImageBitmap(frame.blob);
  const px = (frame.position.x / 100) * bitmap.width;
  const py = (frame.position.y / 100) * bitmap.height;
  const r = cropRect(bitmap.width, bitmap.height, px, py, cropW, cropH);
  const canvas = new OffscreenCanvas(r.w, r.h);
  canvas.getContext("2d").drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

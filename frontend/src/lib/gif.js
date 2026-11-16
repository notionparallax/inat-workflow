// Animated GIF encoding in the browser (SPEC §9.7), using gifenc.
import { GIFEncoder, applyPalette, quantize } from "gifenc";

export const GIF_DEFAULTS = { width: 800, fps: 10, before: 1.5, after: 1.5, maxBytes: 5 * 1024 * 1024 };

/** Decode frame blobs and scale each (optionally only `box`, as {x, y, s}
 *  fractions of the frame) to `width` px wide. Returns RGBA pixel arrays. */
export async function prepareFrames(blobs, width, box = null) {
  const out = [];
  let w = width, h = null;
  for (const blob of blobs) {
    const bmp = await createImageBitmap(blob);
    const sx = box ? box.x * bmp.width : 0, sy = box ? box.y * bmp.height : 0;
    const sw = box ? box.s * bmp.width : bmp.width, sh = box ? box.s * bmp.height : bmp.height;
    w = Math.min(width, Math.round(sw));
    h = Math.round((sh * w) / sw);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    bmp.close();
    out.push(ctx.getImageData(0, 0, w, h).data);
  }
  return { frames: out, width: w, height: h };
}

function scale(frames, w, h, factor) {
  const nw = Math.round(w * factor), nh = Math.round(h * factor);
  const src = new OffscreenCanvas(w, h), dst = new OffscreenCanvas(nw, nh);
  const sctx = src.getContext("2d"), dctx = dst.getContext("2d", { willReadFrequently: true });
  const scaled = frames.map((data) => {
    sctx.putImageData(new ImageData(data, w, h), 0, 0);
    dctx.drawImage(src, 0, 0, nw, nh);
    return dctx.getImageData(0, 0, nw, nh).data;
  });
  return { frames: scaled, width: nw, height: nh };
}

/** One palette for the whole animation (less flicker), sampled from every frame. */
function sharedPalette(frames, colors) {
  const step = 4; // every 4th pixel of every frame
  const per = Math.ceil(frames[0].length / 4 / step);
  const sample = new Uint8ClampedArray(per * frames.length * 4);
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length && k < sample.length; i += 4 * step) {
      sample[k++] = f[i]; sample[k++] = f[i + 1]; sample[k++] = f[i + 2]; sample[k++] = 255;
    }
  }
  return quantize(sample.subarray(0, k), colors);
}

function encodeOnce(frames, width, height, fps, colors) {
  const palette = sharedPalette(frames, colors);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  frames.forEach((data, i) => {
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, i === 0 ? { palette, delay, repeat: 0 } : { delay });
  });
  gif.finish();
  return gif.bytes();
}

/** Encode, reducing colours and then size until the GIF fits `maxBytes`. */
export async function encodeGif(blobs, { width = GIF_DEFAULTS.width, fps = GIF_DEFAULTS.fps, box = null,
                                        maxBytes = GIF_DEFAULTS.maxBytes } = {}) {
  let prepared = await prepareFrames(blobs, width, box);
  let colors = 256;
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = encodeOnce(prepared.frames, prepared.width, prepared.height, fps, colors);
    if (bytes.length <= maxBytes || attempt === 7) {
      return { blob: new Blob([bytes], { type: "image/gif" }), bytes: bytes.length, width: prepared.width,
               height: prepared.height, frames: prepared.frames.length, fps, colors };
    }
    if (colors > 64) colors /= 2;
    else prepared = scale(prepared.frames, prepared.width, prepared.height, 0.85);
    await new Promise((r) => setTimeout(r)); // let the page breathe between attempts
  }
}

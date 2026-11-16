// Client for the frame grabber extension (SPEC §7.2). Messages go to the
// YouTube embed iframe; the extension's content script answers.

const TO_GRABBER = "dive-inat";
const FROM_GRABBER = "dive-inat-grabber";
const YT_ORIGINS = ["https://www.youtube.com", "https://www.youtube-nocookie.com"];

export function createGrabber({ getIframe, onHello, onKey }) {
  let seq = 0;
  const pending = new Map();

  function onMessage(event) {
    if (!YT_ORIGINS.includes(event.origin)) return;
    const d = event.data;
    if (!d || d.source !== FROM_GRABBER) return;
    if (d.type === "hello") return onHello?.(d.version);
    if (d.type === "key") return onKey?.(d);
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    clearTimeout(p.timer);
    d.ok ? p.resolve(d.result) : p.reject(new Error(d.error));
  }
  window.addEventListener("message", onMessage);

  function call(cmd, args = {}, timeoutMs = 60000) {
    const iframe = getIframe();
    if (!iframe?.contentWindow) return Promise.reject(new Error("Player not ready"));
    const origin = new URL(iframe.src).origin;
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The frame grabber didn't answer (${cmd}). Is the extension installed?`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      iframe.contentWindow.postMessage({ source: TO_GRABBER, id, cmd, args }, origin);
    });
  }

  return {
    call,
    ping: () => call("ping", {}, 3000),
    status: () => call("status", {}, 3000),
    grab: () => call("grab"),
    burst: (args) => call("burst", args, 120000),
    step: (frames, fps) => call("step", { frames, fps }),
    seek: (time) => call("seek", { time }),
    quality: (level = "hd2160") => call("quality", { level }, 3000),
    destroy: () => window.removeEventListener("message", onMessage),
  };
}

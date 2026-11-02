// Video thumbnails: one hidden <video> per job (max 2 at a time) grabs a frame into an ImageBitmap.
// Newest request first, so what is on screen now wins over what was scrolled past.
import { convertFileSrc } from "@tauri-apps/api/core";

export type VideoThumb = { bmp: ImageBitmap | null; w: number; h: number; dur: number };

const cache = new Map<string, VideoThumb>();
const waiting = new Map<string, ((r: VideoThumb) => void)[]>();
const queue: string[] = [];
let busy = 0;
const MAX = 2;

export function getVideoThumb(path: string): Promise<VideoThumb> {
  const c = cache.get(path);
  if (c) return Promise.resolve(c);
  return new Promise((res) => {
    let l = waiting.get(path);
    if (!l) {
      l = [];
      waiting.set(path, l);
      queue.push(path);
    }
    l.push(res);
    pump();
  });
}

/** Drop queued (not started) jobs, e.g. when the folder changes. */
export function clearVideoQueue() {
  for (const p of queue) waiting.delete(p);
  queue.length = 0;
}

function pump() {
  while (busy < MAX && queue.length) {
    const p = queue.pop()!;
    busy++;
    grab(p)
      .then((r) => {
        cache.set(p, r);
        waiting.get(p)?.forEach((f) => f(r));
        waiting.delete(p);
      })
      .finally(() => {
        busy--;
        pump();
      });
  }
}

function once(el: HTMLVideoElement, ev: string, ms: number) {
  return new Promise<void>((res, rej) => {
    const t = setTimeout(() => done(rej), ms);
    const ok = () => done(res);
    const bad = () => done(rej);
    function done(f: (v?: any) => void) {
      clearTimeout(t);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
      f();
    }
    el.addEventListener(ev, ok);
    el.addEventListener("error", bad);
  });
}

async function grab(path: string): Promise<VideoThumb> {
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  try {
    const meta = once(v, "loadedmetadata", 20000);
    v.src = convertFileSrc(path);
    await meta;
    const dur = isFinite(v.duration) ? v.duration : 0;
    const t = dur > 0 ? Math.min(dur * 0.1, 3) : 0;
    const ready = once(v, t > 0 ? "seeked" : "loadeddata", 20000);
    if (t > 0) v.currentTime = t;
    await ready;
    const w = v.videoWidth;
    const h = v.videoHeight;
    let bmp: ImageBitmap | null = null;
    if (w && h) {
      const s = Math.min(1, 480 / Math.max(w, h));
      bmp = await createImageBitmap(v, {
        resizeWidth: Math.max(1, Math.round(w * s)),
        resizeHeight: Math.max(1, Math.round(h * s)),
        resizeQuality: "medium",
      });
    }
    return { bmp, w, h, dur };
  } catch {
    return { bmp: null, w: 0, h: 0, dur: 0 };
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

import { useEffect, useRef, useState } from "react";
import { Item, Meta, thumbSrc } from "./lib";
import { getVideoThumb } from "./videoThumbs";
import { IFile, IFolder } from "./icons";

// one shared IntersectionObserver for every lazily loaded cell
const callbacks = new WeakMap<Element, (v: boolean) => void>();
let io: IntersectionObserver | null = null;
const observer = () =>
  (io ??= new IntersectionObserver((es) => es.forEach((e) => callbacks.get(e.target)?.(e.isIntersecting)), {
    rootMargin: "300px",
  }));

export function useInView(ref: React.RefObject<Element | null>) {
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    callbacks.set(el, setV);
    observer().observe(el);
    return () => {
      observer().unobserve(el);
      callbacks.delete(el);
    };
  }, [ref]);
  return v;
}

type ThumbProps = { item: Item; px: number; gen: number; onMeta: (path: string, m: Meta) => void };

export function Thumb({ item, px, gen, onMeta }: ThumbProps) {
  const [bad, setBad] = useState("");
  if (item.kind === "dir") return <div className="thumb-icon"><IFolder size={999} /></div>;
  if (item.kind === "video") return <VideoThumb path={item.path} onMeta={onMeta} />;
  const src = thumbSrc(item, px, gen);
  if (bad === src) return <div className="thumb-icon"><IFile size={999} label={item.ext} /></div>;
  return (
    <img className="thumb-img" loading="lazy" decoding="async" draggable={false} src={src}
      onError={() => setBad(src)} />
  );
}

function VideoThumb({ path, onMeta }: { path: string; onMeta: (path: string, m: Meta) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const vis = useInView(wrap);
  const [state, setState] = useState<"wait" | "ok" | "none">("wait");

  useEffect(() => {
    if (!vis || state !== "wait") return;
    let alive = true;
    getVideoThumb(path).then((r) => {
      if (!alive) return;
      if (r.w || r.dur) onMeta(path, { w: r.w || undefined, h: r.h || undefined, dur: r.dur || undefined });
      const c = canvas.current;
      if (r.bmp && c) {
        c.width = r.bmp.width;
        c.height = r.bmp.height;
        c.getContext("2d")?.drawImage(r.bmp, 0, 0);
        setState("ok");
      } else setState("none");
    });
    return () => {
      alive = false;
    };
  }, [vis, state, path, onMeta]);

  return (
    <div ref={wrap} className="thumb-video">
      <canvas ref={canvas} className="thumb-img" style={{ display: state === "ok" ? undefined : "none" }} />
      {state === "none" && <div className="thumb-icon"><IFile size={999} label={path.split(".").pop()} /></div>}
    </div>
  );
}

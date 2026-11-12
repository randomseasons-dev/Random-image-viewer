import { useCallback, useEffect, useRef, useState } from "react";
import { Item, Meta, fmtDate, fullSrc, infoShort, thumbSrc } from "./lib";
import VideoPlayer from "./VideoPlayer";
import { IBack, IClose, IFolder, IFull, IFwd } from "./icons";

type Props = {
  item: Item | null;
  meta?: Meta;
  picData: boolean;
  fs: boolean;
  index: number;
  total: number;
  px: number;
  gen: number;
  onPrev: () => void;
  onNext: () => void;
  onToggleFs: () => void;
  onMeta: (path: string, m: Meta) => void;
  onWheel: (dy: number) => void;
  /** set by Stage: fullscreen key handler, returns true when it used the key (zoom / pan) */
  keysRef: React.MutableRefObject<((e: KeyboardEvent) => boolean) | null>;
};

// fullscreen zoom, relative to "fit to screen" (100 %)
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
type Zoom = { z: number; x: number; y: number };
const FIT: Zoom = { z: 1, x: 0, y: 0 };

function StageImage({ item, px, gen, onMeta }: { item: Item; px: number; gen: number; onMeta: Props["onMeta"] }) {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <>
      {!loaded && !err && <img className="stage-img ph" src={thumbSrc(item, px, gen)} draggable={false} />}
      <img className={"stage-img" + (loaded ? "" : " loading")} src={fullSrc(item)} draggable={false}
        onLoad={(e) => {
          setLoaded(true);
          onMeta(item.path, { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
        }}
        onError={() => setErr(true)} />
      {err && <div className="stage-empty">Can't display this file.</div>}
    </>
  );
}

export default function Stage(p: Props) {
  const { item, fs } = p;
  const [ui, setUi] = useState(true);
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const hover = useRef(false);
  const timer = useRef(0);

  // fullscreen: controls + cursor hide after 3 s without mouse movement
  const poke = useCallback(() => {
    setUi(true);
    clearTimeout(timer.current);
    if (fs) timer.current = window.setTimeout(() => !hover.current && setUi(false), 3000);
  }, [fs]);
  useEffect(() => {
    hover.current = false;
    poke();
    return () => clearTimeout(timer.current);
  }, [poke]);
  const onHover = useCallback((h: boolean) => {
    hover.current = h;
    if (!h) poke();
  }, [poke]);

  // back to fit when the picture changes or fullscreen ends
  useEffect(() => setZoom(FIT), [item?.path, fs]);

  // keep the picture edges from leaving the screen edges
  const clamp = useCallback((v: Zoom): Zoom => {
    const el = stageRef.current;
    if (!el) return v;
    const W = el.clientWidth, H = el.clientHeight;
    const nw = p.meta?.w || W, nh = p.meta?.h || H;
    const s = Math.min(W / nw, H / nh);
    const mx = Math.max(0, (nw * s * v.z - W) / 2), my = Math.max(0, (nh * s * v.z - H) / 2);
    return { z: v.z, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  }, [p.meta?.w, p.meta?.h]);

  const zoomTo = (z: number) => {
    setZoom((c) => clamp({ z, x: (c.x * z) / c.z, y: (c.y * z) / c.z })); // keep the same spot centred
    poke();
  };
  p.keysRef.current = (e: KeyboardEvent) => {
    if (!fs || item?.kind !== "image") return false;
    const k = e.key;
    if (k === "+" || k === "=" || e.code === "NumpadAdd") {
      zoomTo(ZOOMS.find((z) => z > zoom.z + 1e-6) ?? zoom.z);
      return true;
    }
    if (k === "-" || k === "_" || e.code === "NumpadSubtract") {
      zoomTo([...ZOOMS].reverse().find((z) => z < zoom.z - 1e-6) ?? zoom.z);
      return true;
    }
    if (k === " ") {
      setZoom(FIT);
      poke();
      return true;
    }
    // zoomed: arrows move around the picture; in fit mode they change the picture
    if (zoom.z !== 1 && k.startsWith("Arrow")) {
      const el = stageRef.current;
      const dx = Math.max(60, (el?.clientWidth ?? 800) * 0.1), dy = Math.max(60, (el?.clientHeight ?? 600) * 0.1);
      const mv = { ArrowLeft: [dx, 0], ArrowRight: [-dx, 0], ArrowUp: [0, dy], ArrowDown: [0, -dy] }[k];
      if (mv) setZoom((c) => clamp({ z: c.z, x: c.x + mv[0], y: c.y + mv[1] }));
      return true;
    }
    return false;
  };

  // drag to move a zoomed picture
  const onPointerDown = (e: React.PointerEvent) => {
    if (!fs || zoom.z === 1 || e.button !== 0 || !(e.target as HTMLElement).classList.contains("stage-img")) return;
    const el = e.currentTarget as HTMLElement;
    const x0 = e.clientX, y0 = e.clientY, start = zoom;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => setZoom(clamp({ z: start.z, x: start.x + ev.clientX - x0, y: start.y + ev.clientY - y0 }));
    const up = () => {
      setDragging(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const showUi = !fs || ui;
  const zoomed = fs && item?.kind === "image" && zoom.z !== 1;
  const media = item && item.kind !== "dir";

  return (
    <div ref={stageRef} className={"stage" + (fs ? " fs" : "") + (showUi ? "" : " idle") + (zoomed ? " zoomed" : "") + (dragging ? " dragging" : "")}
      onMouseMove={poke} onPointerDown={onPointerDown}
      onWheel={(e) => fs && !(e.target as HTMLElement).closest(".vp-controls") && p.onWheel(e.deltaY)}
      onDoubleClick={(e) => item?.kind === "image" && (e.target as HTMLElement).classList.contains("stage-img") && p.onToggleFs()}>
      {!item && <div className="stage-empty">Select a picture or video</div>}
      {item?.kind === "dir" && (
        <div className="stage-empty"><IFolder size={96} /><div>{item.name}</div></div>
      )}
      {item?.kind === "image" && (
        <div className="stage-zoom" style={zoomed ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})` } : undefined}>
          <StageImage key={item.path} item={item} px={p.px} gen={p.gen} onMeta={p.onMeta} />
        </div>
      )}
      {item?.kind === "video" && (
        <VideoPlayer key={item.path} item={item} showUi={showUi} fs={fs} onMeta={p.onMeta} onToggleFs={p.onToggleFs} onHover={onHover} />
      )}

      {p.picData && media && (
        <div className="stage-pd">
          <div className="stage-pd-name">{item.name}</div>
          <div>{infoShort(item, p.meta)}</div>
          <div>Modified {fmtDate(item.modified)}</div>
        </div>
      )}

      {!fs && media && (
        <button className="stage-fsbtn" title="Fullscreen (F11)" onClick={p.onToggleFs}><IFull /></button>
      )}
      {fs && (
        <>
          <div className={"fs-top" + (showUi ? "" : " hide")} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
            <span className="fs-count">{p.index + 1} / {p.total}{item?.kind === "image" ? ` · ${Math.round(zoom.z * 100)}%` : ""}</span>
            <button title="Exit fullscreen (Esc)" onClick={p.onToggleFs}><IClose /></button>
          </div>
          {p.total > 1 && (
            <>
              <button className={"fs-nav l" + (showUi ? "" : " hide")} title="Previous (←)" onClick={p.onPrev}
                onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}><IBack size={36} /></button>
              <button className={"fs-nav r" + (showUi ? "" : " hide")} title="Next (→)" onClick={p.onNext}
                onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}><IFwd size={36} /></button>
            </>
          )}
        </>
      )}
    </div>
  );
}

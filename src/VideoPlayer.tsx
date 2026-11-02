import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Item, Meta, fmtDur, load, save } from "./lib";
import { IExitFull, IFf, IFull, IMute, IPause, IPlay, IRew, IVol } from "./icons";

type Props = {
  item: Item;
  showUi: boolean;
  fs: boolean;
  onMeta: (path: string, m: Meta) => void;
  onToggleFs: () => void;
  onHover: (h: boolean) => void;
};

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "SELECT" || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type === "text"));
};

export default function VideoPlayer({ item, showUi, fs, onMeta, onToggleFs, onHover }: Props) {
  const v = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(() => load("vol", 1));
  const [muted, setMuted] = useState(() => load("muted", false));
  const [rate, setRate] = useState(1);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [err, setErr] = useState(false);
  const loopOn = a != null && b != null;

  const ab = useRef({ a, b });
  ab.current = { a, b };

  // A-B loop check + time display, every frame
  useEffect(() => {
    let id = 0;
    let last = -1;
    const tick = () => {
      const el = v.current;
      if (el) {
        const { a, b } = ab.current;
        if (a != null && b != null && !el.paused && el.currentTime >= b) el.currentTime = a;
        if (Math.abs(el.currentTime - last) > 0.04) {
          last = el.currentTime;
          setT(last);
        }
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (v.current) {
      v.current.volume = vol;
      v.current.muted = muted;
    }
    save("vol", vol);
    save("muted", muted);
  }, [vol, muted]);

  useEffect(() => {
    if (v.current) v.current.playbackRate = rate;
  }, [rate]);

  const toggle = () => {
    const el = v.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };
  const seek = (s: number) => {
    const el = v.current;
    if (!el || !isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.duration, s));
    setT(el.currentTime);
  };
  const skip = (d: number) => seek((v.current?.currentTime ?? 0) + d);

  // A: start point (also cancels a running loop). B: end point -> loop on. B again: loop off.
  const markA = () => {
    const el = v.current;
    if (!el || !dur) return;
    setA(el.currentTime);
    setB(null);
  };
  const markB = () => {
    const el = v.current;
    if (!el || a == null) return;
    if (loopOn) return clearAB();
    const now = el.currentTime;
    if (Math.abs(now - a) < 0.2) return;
    if (now < a) {
      setB(a);
      setA(now);
    } else setB(now);
  };
  const clearAB = () => {
    setA(null);
    setB(null);
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") toggle();
    else if (k === "[") markA();
    else if (k === "]") markB();
    else if (k === "\\") clearAB();
    else if (k === "m") setMuted((m) => !m);
    else if (k === "j") skip(-10);
    else if (k === "l") skip(10);
    else if (e.shiftKey && k === "arrowleft") skip(-5);
    else if (e.shiftKey && k === "arrowright") skip(5);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  const pct = (s: number) => (dur ? `${(s / dur) * 100}%` : "0%");

  return (
    <div className="vp">
      <video ref={v} className="stage-img" src={convertFileSrc(item.path)} autoPlay
        onClick={toggle} onDoubleClick={(e) => { e.stopPropagation(); onToggleFs(); }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          el.volume = vol;
          el.muted = muted;
          el.playbackRate = rate;
          const d = isFinite(el.duration) ? el.duration : 0;
          setDur(d);
          onMeta(item.path, { w: el.videoWidth || undefined, h: el.videoHeight || undefined, dur: d || undefined });
        }}
        onDurationChange={(e) => isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        onEnded={(e) => {
          if (loopOn) {
            e.currentTarget.currentTime = a!;
            e.currentTarget.play().catch(() => {});
          }
        }}
        onError={() => setErr(true)} />
      {err && <div className="stage-empty">This video can't be played (codec or container not supported).</div>}

      <div className={"vp-controls" + (showUi ? "" : " hide")} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
        onDoubleClick={(e) => e.stopPropagation()}>
        <div className="vp-seek">
          <div className="vp-track">
            <div className="vp-fill" style={{ width: pct(t) }} />
            {loopOn && <div className="vp-ab" style={{ left: pct(a!), width: pct(b! - a!) }} />}
            {a != null && <div className="vp-mark" style={{ left: pct(a) }}>A</div>}
            {b != null && <div className="vp-mark" style={{ left: pct(b) }}>B</div>}
          </div>
          <input type="range" min={0} max={dur || 1} step={0.01} value={Math.min(t, dur || 1)}
            onChange={(e) => seek(+e.target.value)} />
        </div>
        <div className="vp-row">
          <button className="vp-btn" title="Back 10 s (J)" onClick={() => skip(-10)}><IRew /><small>10</small></button>
          <button className="vp-btn" title="Back 5 s (Shift+←)" onClick={() => skip(-5)}><IRew size={14} /><small>5</small></button>
          <button className="vp-btn big" title="Play / Pause (Space)" onClick={toggle}>{playing ? <IPause size={22} /> : <IPlay size={22} />}</button>
          <button className="vp-btn" title="Forward 5 s (Shift+→)" onClick={() => skip(5)}><small>5</small><IFf size={14} /></button>
          <button className="vp-btn" title="Forward 10 s (L)" onClick={() => skip(10)}><small>10</small><IFf /></button>
          <span className="vp-time">{fmtDur(t)} / {fmtDur(dur)}</span>

          <div className={"vp-loop" + (loopOn ? " on" : a != null ? " armed" : "")}>
            <span className="vp-loop-label">Loop</span>
            <button className={"ab" + (a != null ? " set" : "")} title="Set loop start A at the current time ([)" onClick={markA} disabled={!dur}>A</button>
            <button className={"ab" + (b != null ? " set" : "")} title={loopOn ? "Turn loop off (])" : "Set loop end B and start looping (])"}
              onClick={markB} disabled={a == null}>B</button>
            <span className="vp-loop-range">
              {loopOn ? `${fmtDur(a!)} – ${fmtDur(b!)}` : a != null ? `A ${fmtDur(a)} → press B` : "press A"}
            </span>
            {a != null && <button className="ab clr" title="Clear loop (\)" onClick={clearAB}>✕</button>}
          </div>

          <span className="vp-spacer" />
          <select className="vp-rate" value={rate} title="Speed" onChange={(e) => { setRate(+e.target.value); e.currentTarget.blur(); }}>
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
          <button className="vp-btn" title="Mute (M)" onClick={() => setMuted(!muted)}>{muted || vol === 0 ? <IMute /> : <IVol />}</button>
          <input className="vp-vol" type="range" min={0} max={1} step={0.01} value={muted ? 0 : vol}
            onChange={(e) => { setVol(+e.target.value); setMuted(false); }} />
          <button className="vp-btn" title={fs ? "Exit fullscreen (Esc)" : "Fullscreen"} onClick={onToggleFs}>{fs ? <IExitFull /> : <IFull />}</button>
        </div>
      </div>
    </div>
  );
}

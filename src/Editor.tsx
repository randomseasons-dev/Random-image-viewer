import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Item, fullSrc, load, save } from "./lib";
import { IClose } from "./icons";

type Tool = "rect" | "lasso" | "poly" | "crop" | "brush" | "mosaic" | "text" | "adjust" | "hand";
type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Adj = Record<(typeof ADJ)[number][0], number>;

const TOOLS: [Tool, string, string, string][] = [
  ["rect", "▭", "Rectangle select", "S"],
  ["lasso", "➰", "Free select (lasso)", "L"],
  ["poly", "⬠", "Line select (polygon) — click points, double-click / Enter to close", "P"],
  ["crop", "⛶", "Crop", "C"],
  ["brush", "🖌", "Brush", "B"],
  ["mosaic", "▦", "Mosaic brush", "X"],
  ["text", "T", "Text", "T"],
  ["adjust", "◐", "Color adjust", "A"],
  ["hand", "✋", "Pan (or hold Space / middle mouse)", "H"],
];

const ADJ = [
  ["exposure", "Exposure"],
  ["brightness", "Brightness"],
  ["contrast", "Contrast"],
  ["highlights", "Highlights"],
  ["shadows", "Shadows"],
  ["saturation", "Saturation"],
  ["vibrance", "Vibrance"],
  ["warmth", "Warmth"],
  ["tint", "Tint"],
] as const;
const ADJ_ZERO = Object.fromEntries(ADJ.map(([k]) => [k, 0])) as Adj;
const adjActive = (a: Adj) => ADJ.some(([k]) => a[k] !== 0);

const SAVE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg", png: "image/png", webp: "image/webp" };

function newCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: false })!;
function cloneCanvas(src: HTMLCanvasElement) {
  const c = newCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}
const polyPath = (pts: Pt[]) => {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
  return p;
};
const rectPts = (r: Rect): Pt[] => [
  { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
];
const normRect = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
function bbox(pts: Pt[]): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Color adjustments, per pixel (sliders -100..100) */
function adjustPixels(src: Uint8ClampedArray, dst: Uint8ClampedArray, a: Adj) {
  const ex = Math.pow(2, a.exposure / 50);
  const br = (a.brightness / 100) * 0.35;
  const cf = Math.tan(((a.contrast / 100) * 0.5 + 1) * (Math.PI / 4));
  const sh = (a.shadows / 100) * 0.35;
  const hi = (a.highlights / 100) * 0.35;
  const sat = 1 + a.saturation / 100;
  const vib = a.vibrance / 100;
  const wr = (a.warmth / 100) * 0.12;
  const tn = (a.tint / 100) * 0.12;
  for (let i = 0; i < src.length; i += 4) {
    let r = (src[i] / 255) * ex + br;
    let g = (src[i + 1] / 255) * ex + br;
    let b = (src[i + 2] / 255) * ex + br;
    if (sh || hi) {
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let d = 0;
      if (sh) {
        const w = Math.max(0, 1 - L * 2);
        d += sh * w * w;
      }
      if (hi) {
        const w = Math.max(0, L * 2 - 1);
        d += hi * w * w;
      }
      r += d;
      g += d;
      b += d;
    }
    if (cf !== 1) {
      r = (r - 0.5) * cf + 0.5;
      g = (g - 0.5) * cf + 0.5;
      b = (b - 0.5) * cf + 0.5;
    }
    if (wr || tn) {
      r += wr;
      b -= wr;
      g -= tn;
    }
    if (sat !== 1 || vib) {
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let s = sat;
      if (vib > 0) s *= 1 + vib * (1 - Math.min(1, Math.max(r, g, b) - Math.min(r, g, b)));
      else if (vib < 0) s *= 1 + vib;
      r = L + (r - L) * s;
      g = L + (g - L) * s;
      b = L + (b - L) * s;
    }
    dst[i] = r * 255;
    dst[i + 1] = g * 255;
    dst[i + 2] = b * 255;
    dst[i + 3] = src[i + 3];
  }
}

/** Whole image pixelated with blocks of `block` px (blocks aligned to 0,0) */
function pixelated(src: HTMLCanvasElement, block: number) {
  const small = newCanvas(Math.ceil(src.width / block), Math.ceil(src.height / block));
  const s = ctx2d(small);
  s.imageSmoothingEnabled = true;
  s.imageSmoothingQuality = "high";
  s.drawImage(src, 0, 0, small.width * block, small.height * block, 0, 0, small.width, small.height);
  // edge blocks hang over the image: draw the source stretched so they average real pixels
  const out = newCanvas(src.width, src.height);
  const o = ctx2d(out);
  o.imageSmoothingEnabled = false;
  o.drawImage(small, 0, 0, small.width * block, small.height * block);
  return out;
}

type Props = { item: Item; onClose: () => void; onSaved: (path: string) => void };

export default function Editor({ item, onClose, onSaved }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const doc = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [err, setErr] = useState("");
  const [tool, setToolState] = useState<Tool>("rect");
  const [color, setColor] = useState(() => load("ed.color", "#ff3b30"));
  const [brush, setBrush] = useState(() => load("ed.brush", 24));
  const [opacity, setOpacity] = useState(() => load("ed.opacity", 100));
  const [block, setBlock] = useState(() => load("ed.block", 16));
  const [mbrush, setMbrush] = useState(() => load("ed.mbrush", 80));
  const [fontSize, setFontSize] = useState(() => load("ed.font", 48));
  const [bold, setBold] = useState(() => load("ed.bold", true));
  const [outline, setOutline] = useState(() => load("ed.outline", true));
  const [adj, setAdj] = useState<Adj>(ADJ_ZERO);
  const [sel, setSel] = useState<Pt[] | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [text, setText] = useState<{ x: number; y: number; value: string } | null>(null);
  const [undoN, setUndoN] = useState(0);
  const [redoN, setRedoN] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<"close" | "overwrite" | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  const vt = useRef({ scale: 1, ox: 0, oy: 0 });
  const undo = useRef<HTMLCanvasElement[]>([]);
  const redo = useRef<HTMLCanvasElement[]>([]);
  const st = useRef({ sel, crop, tool, adj, color, brush, opacity, block, mbrush });
  st.current = { sel, crop, tool, adj, color, brush, opacity, block, mbrush };
  const draft = useRef<{ kind: "rect" | "lasso" | "poly" | "crop"; pts: Pt[]; hover?: Pt } | null>(null);
  const drag = useRef<{ mode: string; start: Pt; last: Pt; sx: number; sy: number; ox: number; oy: number; orig?: Rect } | null>(null);
  const stroke = useRef<HTMLCanvasElement | null>(null);
  const mosaicSrc = useRef<HTMLCanvasElement | null>(null);
  const mouse = useRef<Pt | null>(null);
  const space = useRef(false);
  const preview = useRef<{ src: ImageData; out: HTMLCanvasElement } | null>(null);
  const antsOff = useRef(0);

  useEffect(() => save("ed.color", color), [color]);
  useEffect(() => save("ed.brush", brush), [brush]);
  useEffect(() => save("ed.opacity", opacity), [opacity]);
  useEffect(() => save("ed.block", block), [block]);
  useEffect(() => save("ed.mbrush", mbrush), [mbrush]);
  useEffect(() => save("ed.font", fontSize), [fontSize]);
  useEffect(() => save("ed.bold", bold), [bold]);
  useEffect(() => save("ed.outline", outline), [outline]);

  // ---------- drawing ----------
  const raf = useRef(0);
  const draw = useCallback(() => {
    raf.current = 0;
    const c = viewRef.current;
    const d = doc.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#141518";
    g.fillRect(0, 0, cw, ch);
    if (!d) return;
    const { scale, ox, oy } = vt.current;
    const { sel, crop, tool, adj, opacity } = st.current;

    // checkerboard under transparent pixels
    g.save();
    g.beginPath();
    g.rect(ox, oy, d.width * scale, d.height * scale);
    g.clip();
    g.fillStyle = "#3a3a3a";
    g.fillRect(ox, oy, d.width * scale, d.height * scale);
    g.fillStyle = "#4a4a4a";
    for (let y = 0; y < d.height * scale; y += 10)
      for (let x = (y / 10) % 2 ? 10 : 0; x < d.width * scale; x += 20) g.fillRect(ox + x, oy + y, 10, 10);
    g.restore();

    g.save();
    g.translate(ox, oy);
    g.scale(scale, scale);
    g.imageSmoothingEnabled = scale < 2;
    g.imageSmoothingQuality = "high";
    g.drawImage(d, 0, 0);
    if (tool === "adjust" && preview.current && adjActive(adj)) {
      g.save();
      if (sel) g.clip(polyPath(sel));
      g.drawImage(preview.current.out, 0, 0, d.width, d.height);
      g.restore();
    }
    if (stroke.current) {
      g.save();
      if (sel) g.clip(polyPath(sel));
      g.globalAlpha = opacity / 100;
      g.drawImage(stroke.current, 0, 0);
      g.restore();
    }
    g.restore();

    const S = (p: Pt) => ({ x: ox + p.x * scale, y: oy + p.y * scale });
    const ants = (pts: Pt[], close: boolean, extra?: Pt) => {
      if (!pts.length) return;
      g.beginPath();
      const all = extra ? [...pts, extra] : pts;
      all.forEach((p, i) => {
        const s = S(p);
        if (i) g.lineTo(s.x, s.y);
        else g.moveTo(s.x, s.y);
      });
      if (close) g.closePath();
      g.lineWidth = 1;
      g.setLineDash([]);
      g.strokeStyle = "#000";
      g.stroke();
      g.setLineDash([5, 5]);
      g.lineDashOffset = -antsOff.current;
      g.strokeStyle = "#fff";
      g.stroke();
      g.setLineDash([]);
    };

    // crop: dim outside
    const cr = draft.current?.kind === "crop" && draft.current.pts.length === 2 ? normRect(draft.current.pts[0], draft.current.pts[1]) : crop;
    if (cr) {
      const a = S({ x: cr.x, y: cr.y });
      g.save();
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.beginPath();
      g.rect(ox, oy, d.width * scale, d.height * scale);
      g.rect(a.x, a.y, cr.w * scale, cr.h * scale);
      g.fill("evenodd");
      g.strokeStyle = "#fff";
      g.lineWidth = 1.5;
      g.strokeRect(a.x, a.y, cr.w * scale, cr.h * scale);
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = 1;
      for (let k = 1; k < 3; k++) {
        g.beginPath();
        g.moveTo(a.x + (cr.w * scale * k) / 3, a.y);
        g.lineTo(a.x + (cr.w * scale * k) / 3, a.y + cr.h * scale);
        g.moveTo(a.x, a.y + (cr.h * scale * k) / 3);
        g.lineTo(a.x + cr.w * scale, a.y + (cr.h * scale * k) / 3);
        g.stroke();
      }
      g.fillStyle = "#fff";
      g.font = "12px Segoe UI";
      g.fillText(`${Math.round(cr.w)} × ${Math.round(cr.h)}`, a.x + 4, a.y - 6 > 12 ? a.y - 6 : a.y + 16);
      g.restore();
    }

    if (sel) ants(sel, true);
    const dr = draft.current;
    if (dr?.kind === "rect" && dr.pts.length === 2) ants(rectPts(normRect(dr.pts[0], dr.pts[1])), true);
    if (dr?.kind === "lasso") ants(dr.pts, false);
    if (dr?.kind === "poly") {
      ants(dr.pts, false, dr.hover);
      const f = S(dr.pts[0]);
      g.strokeStyle = "#ffd60a";
      g.strokeRect(f.x - 4, f.y - 4, 8, 8);
    }

    // brush cursor
    const m = mouse.current;
    if (m && (tool === "brush" || tool === "mosaic")) {
      const s = S(m);
      const r = ((tool === "brush" ? st.current.brush : st.current.mbrush) / 2) * scale;
      g.beginPath();
      g.arc(s.x, s.y, Math.max(1, r), 0, Math.PI * 2);
      g.strokeStyle = "#000";
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.stroke();
    }
  }, []);
  const redraw = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => redraw(), [sel, crop, tool, adj, opacity, brush, mbrush, redraw]);

  // marching ants
  useEffect(() => {
    if (!sel && tool !== "poly") return;
    const t = setInterval(() => {
      antsOff.current = (antsOff.current + 1) % 10;
      redraw();
    }, 90);
    return () => clearInterval(t);
  }, [sel, tool, redraw]);

  const fit = useCallback(() => {
    const c = viewRef.current;
    const d = doc.current;
    if (!c || !d) return;
    const s = Math.min((c.clientWidth - 40) / d.width, (c.clientHeight - 40) / d.height, 4);
    vt.current = { scale: s, ox: (c.clientWidth - d.width * s) / 2, oy: (c.clientHeight - d.height * s) / 2 };
    setZoomPct(Math.round(s * 100));
    redraw();
  }, [redraw]);

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const v = vt.current;
    const s = Math.max(0.02, Math.min(32, v.scale * factor));
    vt.current = { scale: s, ox: cx - ((cx - v.ox) * s) / v.scale, oy: cy - ((cy - v.oy) * s) / v.scale };
    setZoomPct(Math.round(s * 100));
    redraw();
  };
  const zoom100 = () => {
    const c = viewRef.current!;
    zoomAt(1 / vt.current.scale, c.clientWidth / 2, c.clientHeight / 2);
  };

  useEffect(() => {
    const ro = new ResizeObserver(() => redraw());
    if (viewRef.current) ro.observe(viewRef.current);
    return () => ro.disconnect();
  }, [redraw]);

  // ---------- load ----------
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const src = fullSrc(item);
    img.src = src + (src.includes("?") ? "&" : "?") + "e=" + Date.now();
    img.decode()
      .then(() => {
        const w = img.naturalWidth || 1024;
        const h = img.naturalHeight || 1024;
        const c = newCanvas(w, h);
        ctx2d(c).drawImage(img, 0, 0, w, h);
        doc.current = c;
        setSize({ w, h });
        setBlock((b) => (b ? b : Math.max(8, Math.round(Math.min(w, h) / 60))));
        fit();
      })
      .catch(() => setErr("Can't open this picture for editing."));
  }, [item, fit]);

  // ---------- history ----------
  const maxUndo = () => {
    const d = doc.current;
    return d ? Math.max(3, Math.min(30, Math.floor(400e6 / (d.width * d.height * 4)))) : 10;
  };
  const pushUndo = () => {
    if (!doc.current) return;
    undo.current.push(cloneCanvas(doc.current));
    if (undo.current.length > maxUndo()) undo.current.shift();
    redo.current = [];
    setUndoN(undo.current.length);
    setRedoN(0);
    setDirty(true);
    setMsg("");
  };
  const replaceDoc = (c: HTMLCanvasElement) => {
    const dimsChanged = !doc.current || c.width !== doc.current.width || c.height !== doc.current.height;
    doc.current = c;
    preview.current = null;
    setSize({ w: c.width, h: c.height });
    if (dimsChanged) {
      setSel(null);
      setCrop(null);
      fit();
    }
    redraw();
  };
  const doUndo = () => {
    const p = undo.current.pop();
    if (!p || !doc.current) return;
    redo.current.push(doc.current);
    replaceDoc(p);
    setUndoN(undo.current.length);
    setRedoN(redo.current.length);
    setDirty(true);
  };
  const doRedo = () => {
    const n = redo.current.pop();
    if (!n || !doc.current) return;
    undo.current.push(doc.current);
    replaceDoc(n);
    setUndoN(undo.current.length);
    setRedoN(redo.current.length);
    setDirty(true);
  };

  // ---------- operations ----------
  const transform = (kind: "left" | "right" | "fliph" | "flipv") => {
    const d = doc.current;
    if (!d) return;
    commitAdjust();
    pushUndo();
    const rot = kind === "left" || kind === "right";
    const c = newCanvas(rot ? d.height : d.width, rot ? d.width : d.height);
    const g = ctx2d(c);
    if (kind === "right") g.setTransform(0, 1, -1, 0, d.height, 0);
    else if (kind === "left") g.setTransform(0, -1, 1, 0, 0, d.width);
    else if (kind === "fliph") g.setTransform(-1, 0, 0, 1, d.width, 0);
    else g.setTransform(1, 0, 0, -1, 0, d.height);
    g.drawImage(d, 0, 0);
    setSel(null);
    setCrop(null);
    replaceDoc(c);
    fit();
  };

  const cropTo = (r: Rect) => {
    const d = doc.current;
    if (!d) return;
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const w = Math.min(d.width - x, Math.round(r.w));
    const h = Math.min(d.height - y, Math.round(r.h));
    if (w < 1 || h < 1) return;
    pushUndo();
    const c = newCanvas(w, h);
    ctx2d(c).drawImage(d, x, y, w, h, 0, 0, w, h);
    setCrop(null);
    setSel(null);
    replaceDoc(c);
    fit();
  };

  const mosaicSelection = () => {
    const d = doc.current;
    if (!d || !sel) return;
    pushUndo();
    const pix = pixelated(d, block);
    const g = ctx2d(d);
    g.save();
    g.clip(polyPath(sel));
    g.drawImage(pix, 0, 0);
    g.restore();
    redraw();
  };

  const fillSelection = () => {
    const d = doc.current;
    if (!d || !sel) return;
    pushUndo();
    const g = ctx2d(d);
    g.save();
    g.fillStyle = color;
    g.globalAlpha = opacity / 100;
    g.fill(polyPath(sel));
    g.restore();
    redraw();
  };

  const selectAll = () => {
    const d = doc.current;
    if (d) setSel(rectPts({ x: 0, y: 0, w: d.width, h: d.height }));
  };

  // adjust preview: work on a screen-sized copy, apply full size on commit
  const buildPreview = () => {
    const d = doc.current;
    if (!d) return;
    const s = Math.min(1, 1600 / Math.max(d.width, d.height));
    const c = newCanvas(d.width * s, d.height * s);
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(d, 0, 0, c.width, c.height);
    preview.current = { src: g.getImageData(0, 0, c.width, c.height), out: c };
  };
  useEffect(() => {
    if (tool !== "adjust" || !doc.current) return;
    if (!preview.current) buildPreview();
    const p = preview.current!;
    const out = new ImageData(p.src.width, p.src.height);
    adjustPixels(p.src.data, out.data, adj);
    p.out.getContext("2d")!.putImageData(out, 0, 0);
    redraw();
  }, [adj, tool, size, redraw]);

  const commitAdjust = () => {
    const d = doc.current;
    const a = st.current.adj;
    if (!d || !adjActive(a)) return;
    pushUndo();
    const g = d.getContext("2d", { willReadFrequently: true })!;
    const data = g.getImageData(0, 0, d.width, d.height);
    const out = new ImageData(d.width, d.height);
    adjustPixels(data.data, out.data, a);
    const s = st.current.sel;
    if (s) {
      const t = newCanvas(d.width, d.height);
      ctx2d(t).putImageData(out, 0, 0);
      g.save();
      g.clip(polyPath(s));
      g.drawImage(t, 0, 0);
      g.restore();
    } else g.putImageData(out, 0, 0);
    preview.current = null;
    setAdj(ADJ_ZERO);
    redraw();
  };

  const commitText = () => {
    const d = doc.current;
    const t = text;
    setText(null);
    if (!d || !t || !t.value.trim()) return;
    pushUndo();
    const g = ctx2d(d);
    g.save();
    g.font = `${bold ? "bold " : ""}${fontSize}px "Segoe UI", sans-serif`;
    g.textBaseline = "top";
    g.fillStyle = color;
    g.globalAlpha = opacity / 100;
    g.lineJoin = "round";
    g.strokeStyle = "#000";
    g.lineWidth = Math.max(2, fontSize / 8);
    t.value.split("\n").forEach((line, i) => {
      const y = t.y + i * fontSize * 1.2;
      if (outline) g.strokeText(line, t.x, y);
      g.fillText(line, t.x, y);
    });
    g.restore();
    redraw();
  };

  const setTool = (t: Tool) => {
    if (t === tool) return;
    if (tool === "adjust") commitAdjust();
    preview.current = null;
    if (text) commitText();
    draft.current = null;
    if (t !== "crop") setCrop(null);
    setToolState(t);
  };

  // ---------- pointer ----------
  const toImg = (e: { clientX: number; clientY: number }): Pt => {
    const r = viewRef.current!.getBoundingClientRect();
    const { scale, ox, oy } = vt.current;
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  };
  const clampPt = (p: Pt): Pt => {
    const d = doc.current!;
    return { x: Math.max(0, Math.min(d.width, p.x)), y: Math.max(0, Math.min(d.height, p.y)) };
  };

  const brushLine = (a: Pt, b: Pt) => {
    const s = stroke.current;
    if (!s) return;
    const g = ctx2d(s);
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = brush;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  };

  const mosaicAt = (a: Pt, b: Pt) => {
    const d = doc.current;
    const pix = mosaicSrc.current;
    if (!d || !pix) return;
    const g = ctx2d(d);
    const r = mbrush / 2;
    const s = st.current.sel;
    g.save();
    if (s) g.clip(polyPath(s));
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 3)));
    const done = new Set<number>();
    const cols = Math.ceil(d.width / block);
    for (let k = 0; k <= steps; k++) {
      const cx = a.x + ((b.x - a.x) * k) / steps;
      const cy = a.y + ((b.y - a.y) * k) / steps;
      const x0 = Math.max(0, Math.floor((cx - r) / block));
      const x1 = Math.floor((cx + r) / block);
      const y0 = Math.max(0, Math.floor((cy - r) / block));
      const y1 = Math.floor((cy + r) / block);
      for (let by = y0; by <= y1; by++)
        for (let bx = x0; bx <= x1; bx++) {
          const id = by * cols + bx;
          if (done.has(id)) continue;
          const mx = (bx + 0.5) * block;
          const my = (by + 0.5) * block;
          if (Math.hypot(mx - cx, my - cy) > r + block * 0.35) continue;
          done.add(id);
          g.drawImage(pix, bx * block, by * block, block, block, bx * block, by * block, block, block);
        }
    }
    g.restore();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = doc.current;
    if (!d) return;
    if (text) {
      commitText();
      return;
    }
    const p = toImg(e);
    const panning = e.button === 1 || space.current || tool === "hand";
    if (e.button !== 0 && !panning) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const base = { start: p, last: p, sx: e.clientX, sy: e.clientY, ox: vt.current.ox, oy: vt.current.oy };
    if (panning) {
      drag.current = { mode: "pan", ...base };
      return;
    }
    switch (tool) {
      case "rect":
        draft.current = { kind: "rect", pts: [clampPt(p), clampPt(p)] };
        drag.current = { mode: "rect", ...base };
        break;
      case "lasso":
        draft.current = { kind: "lasso", pts: [clampPt(p)] };
        drag.current = { mode: "lasso", ...base };
        break;
      case "poly": {
        const dr = draft.current;
        if (dr?.kind === "poly") {
          const f = dr.pts[0];
          const near = Math.hypot(f.x - p.x, f.y - p.y) * vt.current.scale < 9;
          if (near && dr.pts.length >= 3) {
            setSel(dr.pts);
            draft.current = null;
          } else dr.pts.push(clampPt(p));
        } else draft.current = { kind: "poly", pts: [clampPt(p)] };
        break;
      }
      case "crop":
        if (crop && p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) {
          drag.current = { mode: "cropmove", ...base, orig: crop };
        } else {
          draft.current = { kind: "crop", pts: [clampPt(p), clampPt(p)] };
          drag.current = { mode: "crop", ...base };
        }
        break;
      case "brush":
        pushUndo();
        stroke.current = newCanvas(d.width, d.height);
        brushLine(p, p);
        drag.current = { mode: "brush", ...base };
        break;
      case "mosaic":
        pushUndo();
        mosaicSrc.current = pixelated(d, block);
        mosaicAt(p, p);
        drag.current = { mode: "mosaic", ...base };
        break;
      case "text":
        setText({ x: p.x, y: p.y, value: "" });
        break;
      case "adjust":
        break;
    }
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!doc.current) return;
    const p = toImg(e);
    mouse.current = p;
    const dg = drag.current;
    const dr = draft.current;
    if (dg) {
      if (dg.mode === "pan") {
        vt.current = { ...vt.current, ox: dg.ox + e.clientX - dg.sx, oy: dg.oy + e.clientY - dg.sy };
      } else if ((dg.mode === "rect" || dg.mode === "crop") && dr) {
        dr.pts[1] = clampPt(p);
      } else if (dg.mode === "lasso" && dr) {
        const l = dr.pts[dr.pts.length - 1];
        if (Math.hypot(l.x - p.x, l.y - p.y) * vt.current.scale > 2) dr.pts.push(clampPt(p));
      } else if (dg.mode === "cropmove" && dg.orig) {
        const d = doc.current;
        const o = dg.orig;
        setCrop({
          ...o,
          x: Math.max(0, Math.min(d.width - o.w, o.x + p.x - dg.start.x)),
          y: Math.max(0, Math.min(d.height - o.h, o.y + p.y - dg.start.y)),
        });
      } else if (dg.mode === "brush") {
        brushLine(dg.last, p);
      } else if (dg.mode === "mosaic") {
        mosaicAt(dg.last, p);
      }
      dg.last = p;
    } else if (dr?.kind === "poly") {
      dr.hover = p;
    }
    redraw();
  };

  const onPointerUp = () => {
    const dg = drag.current;
    const dr = draft.current;
    drag.current = null;
    if (!dg) return;
    if (dg.mode === "rect" && dr) {
      const r = normRect(dr.pts[0], dr.pts[1]);
      setSel(r.w * vt.current.scale > 3 && r.h * vt.current.scale > 3 ? rectPts(r) : null);
      draft.current = null;
    } else if (dg.mode === "lasso" && dr) {
      setSel(dr.pts.length > 2 ? dr.pts : null);
      draft.current = null;
    } else if (dg.mode === "crop" && dr) {
      const r = normRect(dr.pts[0], dr.pts[1]);
      setCrop(r.w > 2 && r.h > 2 ? r : null);
      draft.current = null;
    } else if (dg.mode === "brush" && stroke.current && doc.current) {
      const g = ctx2d(doc.current);
      const s = st.current.sel;
      g.save();
      if (s) g.clip(polyPath(s));
      g.globalAlpha = opacity / 100;
      g.drawImage(stroke.current, 0, 0);
      g.restore();
      stroke.current = null;
    } else if (dg.mode === "mosaic") {
      mosaicSrc.current = null;
    }
    redraw();
  };

  const onDoubleClick = () => {
    const dr = draft.current;
    if (dr?.kind === "poly" && dr.pts.length >= 3) {
      setSel(dr.pts);
      draft.current = null;
      redraw();
    }
  };

  // ---------- save ----------
  const encode = async (mime: string) => {
    const d = doc.current!;
    let src = d;
    if (mime === "image/jpeg") {
      src = newCanvas(d.width, d.height);
      const g = ctx2d(src);
      g.fillStyle = "#fff";
      g.fillRect(0, 0, d.width, d.height);
      g.drawImage(d, 0, 0);
    }
    const blob = await new Promise<Blob | null>((res) => src.toBlob(res, mime, 0.92));
    if (!blob) throw new Error("encode failed");
    return new Uint8Array(await blob.arrayBuffer());
  };

  const doSave = async (overwrite: boolean) => {
    if (!doc.current) return;
    commitAdjust();
    if (text) commitText();
    setConfirm(null);
    const keep = SAVE_TYPES[item.ext];
    const mime = keep ?? "image/png";
    const dot = item.path.lastIndexOf(".");
    const stem = dot > item.path.lastIndexOf("\\") ? item.path.slice(0, dot) : item.path;
    const target = overwrite ? item.path : `${stem}_edited.${keep ? item.ext : "png"}`;
    try {
      setMsg("Saving…");
      const bytes = await encode(mime);
      const saved = await invoke<string>("save_image", bytes, {
        headers: { "x-path": encodeURIComponent(target), "x-unique": overwrite ? "0" : "1" },
      });
      setDirty(false);
      setMsg(`Saved: ${saved.split("\\").pop()}`);
      onSaved(saved);
    } catch (e) {
      setMsg(`Save failed: ${e}`);
    }
  };

  const tryClose = () => {
    if (dirty) setConfirm("close");
    else onClose();
  };

  // ---------- keys ----------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") || t.tagName === "SELECT";
    if (typing) return; // (the viewer behind ignores keys typed into fields)
    e.stopPropagation(); // the viewer behind must not react
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (k === " ") space.current = true;
    if (ctrl && k === "z" && !e.shiftKey) doUndo();
    else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) doRedo();
    else if (ctrl && k === "a") selectAll();
    else if (ctrl && k === "d") setSel(null);
    else if (ctrl && k === "s") doSave(false);
    else if (ctrl && (k === "0")) fit();
    else if (ctrl && (k === "1")) zoom100();
    else if (k === "enter") {
      const dr = draft.current;
      if (dr?.kind === "poly" && dr.pts.length >= 3) {
        setSel(dr.pts);
        draft.current = null;
      } else if (tool === "crop" && crop) cropTo(crop);
      else if (tool === "adjust") commitAdjust();
    } else if (k === "escape") {
      if (confirm) setConfirm(null);
      else if (draft.current) draft.current = null;
      else if (crop) setCrop(null);
      else if (sel) setSel(null);
      else tryClose();
    } else if (k === "delete" && sel) fillSelection();
    else if (k === "[") (tool === "mosaic" ? setMbrush : setBrush)((v: number) => Math.max(2, Math.round(v / 1.2)));
    else if (k === "]") (tool === "mosaic" ? setMbrush : setBrush)((v: number) => Math.min(1000, Math.round(v * 1.2)));
    else if (!ctrl && !e.altKey) {
      const hit = TOOLS.find((x) => x[3].toLowerCase() === k);
      if (!hit) return;
      setTool(hit[0]);
    } else return;
    e.preventDefault();
    redraw();
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") space.current = false;
      e.stopPropagation();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, []);

  // ---------- render ----------
  const textScreen = text ? { x: vt.current.ox + text.x * vt.current.scale, y: vt.current.oy + text.y * vt.current.scale } : null;
  const canOverwrite = !!SAVE_TYPES[item.ext];

  return (
    <div className="editor">
      <div className="ed-top">
        <span className="ed-title" title={item.path}>Edit — {item.name}</span>
        <span className="ed-size">{size.w} × {size.h}</span>
        <button onClick={doUndo} disabled={!undoN} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button onClick={doRedo} disabled={!redoN} title="Redo (Ctrl+Y)">↷ Redo</button>
        <span className="ed-sep" />
        <button onClick={() => transform("left")} title="Rotate left">⟲ 90°</button>
        <button onClick={() => transform("right")} title="Rotate right">⟳ 90°</button>
        <button onClick={() => transform("fliph")} title="Flip horizontal">⇋ Flip</button>
        <button onClick={() => transform("flipv")} title="Flip vertical">⇵ Flip</button>
        <span className="ed-sep" />
        <button onClick={fit} title="Fit (Ctrl+0)">Fit</button>
        <button onClick={zoom100} title="100% (Ctrl+1)">100%</button>
        <span className="ed-zoom">{zoomPct}%</span>
        <span className="ed-msg">{msg}</span>
        {confirm === "overwrite" ? (
          <span className="ed-confirm">Replace the original file?
            <button className="danger" onClick={() => doSave(true)}>Overwrite</button>
            <button onClick={() => setConfirm(null)}>Cancel</button>
          </span>
        ) : confirm === "close" ? (
          <span className="ed-confirm">Discard unsaved changes?
            <button className="danger" onClick={onClose}>Discard</button>
            <button onClick={() => setConfirm(null)}>Keep editing</button>
          </span>
        ) : (
          <>
            <button className="primary" onClick={() => doSave(false)} title="Save as a new file next to the original (Ctrl+S)">Save copy</button>
            <button onClick={() => setConfirm("overwrite")} disabled={!canOverwrite}
              title={canOverwrite ? "Overwrite the original file" : "This format can only be saved as a PNG copy"}>Overwrite</button>
          </>
        )}
        <button className="ed-close" onClick={tryClose} title="Close (Esc)"><IClose /></button>
      </div>

      <div className="ed-opts">
        {(tool === "brush" || tool === "text") && (
          <>
            <label>Color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            <label>Opacity <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /> <b>{opacity}%</b></label>
          </>
        )}
        {tool === "brush" && (
          <label>Size <input type="range" min={1} max={400} value={brush} onChange={(e) => setBrush(+e.target.value)} /> <b>{brush}px</b></label>
        )}
        {tool === "mosaic" && (
          <>
            <label>Brush <input type="range" min={10} max={1000} value={mbrush} onChange={(e) => setMbrush(+e.target.value)} /> <b>{mbrush}px</b></label>
            <label>Block <input type="range" min={3} max={120} value={block} onChange={(e) => setBlock(+e.target.value)} /> <b>{block}px</b></label>
          </>
        )}
        {tool === "text" && (
          <>
            <label>Size <input type="range" min={8} max={400} value={fontSize} onChange={(e) => setFontSize(+e.target.value)} /> <b>{fontSize}px</b></label>
            <label><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold</label>
            <label><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> Outline</label>
            <span className="ed-hint">Click on the picture, type, Enter to place (Shift+Enter = new line)</span>
          </>
        )}
        {tool === "crop" && (
          <>
            <span className="ed-hint">{crop ? `${Math.round(crop.w)} × ${Math.round(crop.h)} — drag inside to move` : "Drag a rectangle to crop"}</span>
            <button className="primary" disabled={!crop} onClick={() => crop && cropTo(crop)}>Apply crop (Enter)</button>
            <button disabled={!crop} onClick={() => setCrop(null)}>Cancel</button>
          </>
        )}
        {(tool === "rect" || tool === "lasso" || tool === "poly") && !sel && (
          <span className="ed-hint">
            {tool === "rect" ? "Drag to select a rectangle" : tool === "lasso" ? "Hold the mouse and draw around an area" : "Click points to draw lines; double-click, Enter or click the first point to close"}
            {" "}· Ctrl+A select all
          </span>
        )}
        {tool === "adjust" && (
          <div className="ed-adj">
            {ADJ.map(([k, label]) => (
              <label key={k} onDoubleClick={() => setAdj({ ...adj, [k]: 0 })} title="Double-click to reset">
                <span>{label}</span>
                <input type="range" min={-100} max={100} value={adj[k]} onChange={(e) => setAdj({ ...adj, [k]: +e.target.value })} />
                <b>{adj[k] > 0 ? "+" : ""}{adj[k]}</b>
              </label>
            ))}
            <div className="ed-adj-btns">
              <button className="primary" disabled={!adjActive(adj)} onClick={commitAdjust}>Apply (Enter)</button>
              <button disabled={!adjActive(adj)} onClick={() => setAdj(ADJ_ZERO)}>Reset</button>
              {sel && <span className="ed-hint">Only the selected area</span>}
            </div>
          </div>
        )}
        {tool === "hand" && <span className="ed-hint">Drag to move · mouse wheel to zoom</span>}
        {sel && tool !== "adjust" && (
          <span className="ed-selacts">
            <span className="ed-hint">Selection:</span>
            <button onClick={mosaicSelection} title="Pixelate the selected area (block size from the Mosaic tool)">Mosaic</button>
            <button onClick={fillSelection} title="Fill with the brush color (Delete)">Fill <i className="swatch" style={{ background: color }} /></button>
            <button onClick={() => cropTo(bbox(sel))}>Crop to selection</button>
            <button onClick={() => setSel(null)} title="Ctrl+D">Deselect</button>
          </span>
        )}
      </div>

      <div className="ed-body">
        <div className="ed-tools">
          {TOOLS.map(([t, icon, title, key]) => (
            <button key={t} className={tool === t ? "on" : ""} title={`${title} (${key})`} onClick={() => setTool(t)}>
              <span className="ed-ti">{icon}</span>
            </button>
          ))}
        </div>
        <div className="ed-canvas" ref={wrapRef}>
          <canvas ref={viewRef} className={"ed-view tool-" + tool}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onPointerLeave={() => { mouse.current = null; redraw(); }}
            onDoubleClick={onDoubleClick}
            onWheel={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
            }}
            onContextMenu={(e) => e.preventDefault()} />
          {text && textScreen && (
            <textarea className="ed-text" autoFocus value={text.value}
              style={{
                left: textScreen.x, top: textScreen.y, color, fontSize: fontSize * vt.current.scale,
                fontWeight: bold ? 700 : 400, WebkitTextStroke: outline ? `${Math.max(0.5, (fontSize / 16) * vt.current.scale)}px #000` : undefined,
              }}
              onChange={(e) => setText({ ...text, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setText(null);
                }
              }} />
          )}
          {err && <div className="stage-empty">{err}</div>}
        </div>
      </div>
    </div>
  );
}

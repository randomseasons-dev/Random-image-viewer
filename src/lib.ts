import { convertFileSrc } from "@tauri-apps/api/core";

export type Entry = { name: string; path: string; is_dir: boolean; size: number; created: number; modified: number };
export type Kind = "dir" | "image" | "video";
export type Item = Entry & { ext: string; kind: Kind };
export type Place = { name: string; path: string; kind: "quick" | "drive" };
export type Meta = { w?: number; h?: number; dur?: number };
export type View = "thumbs" | "list" | "details";
export type SortKey = "name" | "modified" | "created" | "size" | "type" | "dims";

// shown by the webview directly
const NATIVE = "jpg jpeg jpe jfif pjpeg pjp png apng gif webp bmp dib ico svg avif".split(" ");
// decoded in Rust and served as PNG
const CONVERT = new Set("tif tiff tga dds hdr exr qoi pnm pbm pgm ppm pam ff".split(" "));
// no Rust decoder: thumbnail = the file itself
const DIRECT = new Set(["svg", "avif"]);
const IMAGE = new Set([...NATIVE, ...CONVERT]);
const VIDEO = new Set("mp4 m4v webm mov mkv ogv 3gp".split(" "));

export const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

export function toItem(e: Entry): Item | null {
  if (e.is_dir) return { ...e, ext: "", kind: "dir" };
  const ext = extOf(e.name);
  if (IMAGE.has(ext)) return { ...e, ext, kind: "image" };
  if (VIDEO.has(ext)) return { ...e, ext, kind: "video" };
  return null;
}

const thumbUrl = (path: string, w: number, g: number) => `${convertFileSrc(path, "thumb")}?w=${w}&g=${g}`;

export const bucket = (px: number) => [128, 256, 384, 512, 768, 1024].find((b) => b >= px) ?? 1024;

export const thumbSrc = (it: Item, w: number, g: number) =>
  DIRECT.has(it.ext) ? convertFileSrc(it.path) : thumbUrl(it.path, w, g);

export const fullSrc = (it: Item) => (CONVERT.has(it.ext) ? thumbUrl(it.path, 0, 0) : convertFileSrc(it.path));

export function normPath(p: string) {
  let t = p.trim().replace(/^"|"$/g, "").replace(/\//g, "\\");
  if (/^[A-Za-z]:$/.test(t)) t += "\\";
  if (t.length > 3) t = t.replace(/\\+$/, "");
  return t;
}

export function parentOf(p: string) {
  if (!p) return "";
  const t = p.replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(t)) return "";
  const k = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  if (k < 0) return "";
  const par = t.slice(0, k);
  return /^[A-Za-z]:$/.test(par) ? par + "\\" : par;
}

export function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
export const fmtDate = (ms: number) => (ms ? dateFmt.format(ms) : "");

export function fmtDur(s?: number) {
  if (s == null || !isFinite(s)) return "";
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const fmtDims = (m?: Meta) => (m?.w && m.h ? `${m.w} × ${m.h}` : "");

export const typeName = (it: Item) => (it.kind === "dir" ? "Folder" : it.ext.toUpperCase());

/** The little "pic data" line: dimensions · length · size · type */
export function infoShort(it: Item, m?: Meta) {
  const parts = [fmtDims(m) || "…"];
  if (it.kind === "video" && m?.dur) parts.push(fmtDur(m.dur));
  parts.push(fmtSize(it.size), typeName(it));
  return parts.join(" · ");
}

export function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem("pv." + k);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
}

export function save(k: string, v: unknown) {
  try {
    localStorage.setItem("pv." + k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

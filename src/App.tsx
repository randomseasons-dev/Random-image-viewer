import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Entry, Item, Meta, Place, SortKey, View, bucket, fmtSize, infoShort, load, normPath, parentOf, save, shuffleRank, toItem } from "./lib";
import { clearVideoQueue } from "./videoThumbs";
import Tree from "./Tree";
import FileView from "./FileView";
import Stage from "./Stage";
import Editor from "./Editor";
import { IBack, IEdit, IFull, IFwd, IInfo, IRefresh, IShuffle, ISortAsc, ISortDesc, IUp } from "./icons";
import "./App.css";

const PRESETS: [string, number][] = [
  ["Huge thumbnails", 640],
  ["Extra large thumbnails", 400],
  ["Large thumbnails", 256],
  ["Medium thumbnails", 160],
  ["Small thumbnails", 96],
];
const SORTS: [SortKey, string][] = [
  ["name", "Name"],
  ["modified", "Date modified"],
  ["created", "Date created"],
  ["size", "Size"],
  ["type", "Type"],
  ["dims", "Dimensions"],
  ["shuffle", "Shuffled"],
];
type ClipFiles = { paths: string[]; cut: boolean };
type Menu = { x: number; y: number; item: Item | null; canPaste: boolean };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function Splitter({ onDrag }: { onDrag: (dx: number, done: boolean) => void }) {
  return (
    <div className="splitter"
      onPointerDown={(e) => {
        const x0 = e.clientX;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        el.classList.add("drag");
        const move = (ev: PointerEvent) => onDrag(ev.clientX - x0, false);
        const up = (ev: PointerEvent) => {
          onDrag(ev.clientX - x0, true);
          el.classList.remove("drag");
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }} />
  );
}

export default function App() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [entries, setEntries] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [gen, setGen] = useState(0);
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [selPath, setSelPath] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<View>(() => load("view", "thumbs"));
  const [thumb, setThumb] = useState<number>(() => load("thumb", 160));
  const [sortKey, setSortKey] = useState<SortKey>(() => load("sortKey", "name"));
  const [sortDesc, setSortDesc] = useState<boolean>(() => load("sortDesc", false));
  const [picData, setPicData] = useState<boolean>(() => load("picData", false));
  const [fs, setFs] = useState(false);
  const [treeW, setTreeW] = useState<number>(() => load("treeW", 230));
  const [prevW, setPrevW] = useState<number>(() => load("prevW", 520));
  const [sels, setSels] = useState<Set<string>>(new Set());
  const [cutSet, setCutSet] = useState<Set<string>>(new Set());
  const [seed, setSeed] = useState(() => (Math.random() * 2 ** 32) >>> 0);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [notice, setNotice] = useState("");
  const anchor = useRef<string | null>(null);
  const stageKeys = useRef<((e: KeyboardEvent) => boolean) | null>(null);

  const genRef = useRef(0);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const hist = useRef<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] });
  const filesRef = useRef<HTMLDivElement>(null);
  const placesRef = useRef<Place[]>([]);

  useEffect(() => save("view", view), [view]);
  useEffect(() => save("thumb", thumb), [thumb]);
  useEffect(() => save("sortKey", sortKey), [sortKey]);
  useEffect(() => save("sortDesc", sortDesc), [sortDesc]);
  useEffect(() => save("picData", picData), [picData]);

  const selectPaths = useCallback((paths: string[], focus?: string) => {
    setSels(new Set(paths));
    const f = focus ?? paths[0] ?? null;
    setSelPath(f);
    anchor.current = f;
  }, []);

  // ---------- folder loading ----------
  const loadDir = useCallback(async (path: string, select?: string | string[]) => {
    const g = ++genRef.current;
    clearVideoQueue();
    setLoading(true);
    setError("");
    try {
      await invoke("set_gen", { g });
      let items: Item[];
      if (path === "") {
        items = placesRef.current
          .filter((p) => p.kind === "drive")
          .map((p) => ({ name: p.name, path: p.path, is_dir: true, size: 0, created: 0, modified: 0, ext: "", kind: "dir" }));
      } else {
        const list = await invoke<Entry[]>("list_dir", { path });
        items = list.map(toItem).filter((x): x is Item => x !== null);
      }
      if (genRef.current !== g) return;
      setGen(g);
      setEntries(items);
      setMeta({});
      selectPaths(select === undefined ? [] : typeof select === "string" ? [select] : select);
      setFilter("");
    } catch (e) {
      if (genRef.current !== g) return;
      setError(String(e));
      setEntries([]);
    } finally {
      if (genRef.current === g) {
        setLoading(false);
        setCwd(path);
        setAddr(path);
        if (path) save("cwd", path);
      }
    }
  }, [selectPaths]);

  const go = useCallback((path: string, select?: string) => {
    const cur = cwdRef.current;
    if (cur !== null && cur !== path) {
      hist.current.back.push(cur);
      hist.current.fwd = [];
    }
    loadDir(path, select);
  }, [loadDir]);

  const openPath = useCallback(async (raw: string) => {
    const p = normPath(raw);
    if (!p || p.toLowerCase() === "this pc") return go("");
    const k = await invoke<string>("path_kind", { path: p });
    if (k === "dir") go(p);
    else if (k === "file") go(parentOf(p), p);
    else setError(`Not found: ${p}`);
  }, [go]);

  const back = () => {
    const h = hist.current;
    const p = h.back.pop();
    if (p === undefined || cwd === null) return;
    h.fwd.push(cwd);
    loadDir(p);
  };
  const fwd = () => {
    const h = hist.current;
    const p = h.fwd.pop();
    if (p === undefined || cwd === null) return;
    h.back.push(cwd);
    loadDir(p);
  };
  const up = () => cwd && go(parentOf(cwd), cwd);
  const refresh = () => cwd !== null && loadDir(cwd, [...sels]);

  // startup: command-line file/folder, else last folder, else Pictures
  useEffect(() => {
    (async () => {
      const pl = await invoke<Place[]>("get_places");
      placesRef.current = pl;
      setPlaces(pl);
      const arg = await invoke<string | null>("startup_path");
      const last = load<string>("cwd", "");
      if (arg) return openPath(arg);
      if (last && (await invoke<string>("path_kind", { path: last })) === "dir") return loadDir(last);
      const pics = pl.find((p) => p.name === "Pictures");
      loadDir(pics ? pics.path : "");
    })();
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths.length) openPath(e.payload.paths[0]);
    });
    // another picture double-clicked in Explorer while the app is open
    const unOpen = listen<string>("open-path", (e) => openPath(e.payload));
    return () => {
      un.then((f) => f());
      unOpen.then((f) => f());
    };
  }, [loadDir, openPath]);

  // ---------- meta (dimensions / length) ----------
  const updateMeta = useCallback((path: string, m: Meta) => {
    setMeta((cur) => {
      const o = cur[path];
      if (o && o.w === (m.w ?? o.w) && o.h === (m.h ?? o.h) && o.dur === (m.dur ?? o.dur)) return cur;
      return { ...cur, [path]: { ...o, ...m } };
    });
  }, []);

  const needDims = picData || view === "details" || sortKey === "dims";
  const metaRef = useRef(meta);
  metaRef.current = meta;
  useEffect(() => {
    if (!needDims) return;
    const imgs = entries.filter((e) => e.kind === "image" && !metaRef.current[e.path]?.w);
    if (!imgs.length) return;
    let stop = false;
    (async () => {
      for (let i = 0; i < imgs.length && !stop; i += 100) {
        const chunk = imgs.slice(i, i + 100);
        const r = await invoke<([number, number] | null)[]>("get_dims", { paths: chunk.map((c) => c.path) });
        if (stop) return;
        setMeta((cur) => {
          const n = { ...cur };
          chunk.forEach((c, j) => {
            const d = r[j];
            if (d && !n[c.path]?.w) n[c.path] = { ...n[c.path], w: d[0], h: d[1] };
          });
          return n;
        });
      }
    })();
    return () => {
      stop = true;
    };
  }, [entries, needDims]);

  // ---------- sorting / filtering ----------
  const dimsMeta = sortKey === "dims" ? meta : null;
  const sorted = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? entries.filter((e) => e.name.toLowerCase().includes(f)) : [...entries];
    const area = (e: Item) => (dimsMeta?.[e.path]?.w ?? 0) * (dimsMeta?.[e.path]?.h ?? 0);
    const sign = sortDesc ? -1 : 1;
    return list.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let c = 0;
      if (sortKey === "size") c = a.size - b.size;
      else if (sortKey === "modified") c = a.modified - b.modified;
      else if (sortKey === "created") c = a.created - b.created;
      else if (sortKey === "type") c = collator.compare(a.ext, b.ext);
      else if (sortKey === "dims") c = area(a) - area(b);
      else if (sortKey === "shuffle") return shuffleRank(a.path, seed) - shuffleRank(b.path, seed);
      if (c === 0) c = collator.compare(a.name, b.name);
      return c * sign;
    });
  }, [entries, filter, sortKey, sortDesc, dimsMeta, seed]);

  const media = useMemo(() => sorted.filter((i) => i.kind !== "dir"), [sorted]);
  const sel = useMemo(() => sorted.find((i) => i.path === selPath) ?? null, [sorted, selPath]);
  const mediaIdx = sel ? media.indexOf(sel) : -1;

  // ---------- actions ----------
  const setFullscreen = useCallback(async (on: boolean) => {
    setFs(on);
    try {
      await getCurrentWindow().setFullscreen(on);
    } catch {
      /* window stays as is */
    }
  }, []);

  const toggleFs = () => {
    if (fs) return setFullscreen(false);
    if (!sel || sel.kind === "dir") {
      if (!media.length) return;
      selectPaths([media[0].path]);
    }
    setFullscreen(true);
  };

  // d = +-1 wraps around; bigger jumps stop at the ends
  const step = (d: number) => {
    if (!media.length) return;
    const n = media.length;
    const i = mediaIdx < 0 ? 0 : Math.abs(d) === 1 ? (mediaIdx + d + n) % n : Math.max(0, Math.min(n - 1, mediaIdx + d));
    selectPaths([media[i].path]);
  };

  const wheelAt = useRef(0);
  const onStageWheel = (dy: number) => {
    const now = performance.now();
    if (now - wheelAt.current < 120 || Math.abs(dy) < 1) return;
    wheelAt.current = now;
    step(dy > 0 ? 1 : -1);
  };

  const onOpen = useCallback((it: Item) => {
    if (it.kind === "dir") go(it.path);
    else {
      selectPaths([it.path]);
      setFullscreen(true);
    }
  }, [go, setFullscreen, selectPaths]);

  // ---------- selection: click, Ctrl+click, Shift+click ----------
  const sortedRef = useRef<Item[]>([]);
  sortedRef.current = sorted;
  const selsRef = useRef(sels);
  selsRef.current = sels;
  const rangeTo = (path: string, add: boolean) => {
    const list = sortedRef.current;
    const a = list.findIndex((i) => i.path === anchor.current);
    const b = list.findIndex((i) => i.path === path);
    if (a < 0 || b < 0) return new Set([path]);
    const r = new Set(add ? selsRef.current : []);
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) r.add(list[k].path);
    return r;
  };
  const onPick = useCallback((path: string, e: React.MouseEvent) => {
    if (e.button === 2) {
      if (!selsRef.current.has(path)) selectPaths([path]);
      else setSelPath(path);
      return;
    }
    if (e.button !== 0) return;
    if (e.shiftKey) {
      setSels(rangeTo(path, e.ctrlKey));
      setSelPath(path);
    } else if (e.ctrlKey) {
      const n = new Set(selsRef.current);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      setSels(n);
      setSelPath(path);
      anchor.current = path;
    } else selectPaths([path]);
  }, [selectPaths]);
  const onBlank = useCallback(() => selectPaths([]), [selectPaths]);

  // ---------- clipboard (shared with Windows Explorer) ----------
  const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  const copySel = async (cut: boolean) => {
    const paths = sorted.filter((i) => sels.has(i.path)).map((i) => i.path);
    if (!paths.length) return;
    try {
      await invoke("clipboard_set", { paths, cut });
      setCutSet(cut ? new Set(paths) : new Set());
      setNotice(`${cut ? "Cut" : "Copied"} ${plural(paths.length)}`);
    } catch (e) {
      setNotice(`Clipboard error: ${e}`);
    }
  };
  const paste = async () => {
    if (!cwd) return setNotice("Open a folder to paste into");
    const c = await invoke<ClipFiles>("clipboard_files");
    if (!c.paths.length) return setNotice("No files on the clipboard");
    const dest = cwd;
    setNotice(`${c.cut ? "Moving" : "Copying"} ${plural(c.paths.length)}…`);
    try {
      const made = await invoke<string[]>("paste_files", { dest, paths: c.paths, mv: c.cut });
      if (c.cut) setCutSet(new Set());
      setNotice(`${c.cut ? "Moved" : "Copied"} ${plural(made.length)}`);
      if (cwdRef.current === dest) loadDir(dest, made);
    } catch (e) {
      setNotice(String(e));
      if (cwdRef.current === dest) loadDir(dest);
    }
  };

  // Delete key: to the Recycle Bin (like Explorer), then select the next item
  const deleting = useRef(false);
  const del = async () => {
    const targets = fs ? (sel && sel.kind !== "dir" ? [sel] : []) : sorted.filter((i) => sels.has(i.path));
    if (!targets.length || deleting.current) return;
    deleting.current = true;
    const list = fs ? media : sorted;
    const gone = new Set(targets.map((t) => t.path));
    const last = Math.max(...targets.map((t) => list.indexOf(t)));
    const next = list.slice(last + 1).find((i) => !gone.has(i.path)) ?? [...list.slice(0, last)].reverse().find((i) => !gone.has(i.path));
    try {
      const done = new Set(await invoke<string[]>("recycle", { paths: [...gone] }));
      if (!done.size) return setNotice("Nothing deleted");
      setEntries((cur) => cur.filter((i) => !done.has(i.path)));
      setCutSet((cur) => new Set([...cur].filter((x) => !done.has(x))));
      const keep = targets.filter((t) => !done.has(t.path)).map((t) => t.path);
      if (keep.length) selectPaths(keep);
      else if (next) selectPaths([next.path]);
      else {
        selectPaths([]);
        if (fs) setFullscreen(false);
      }
      setNotice(`Moved ${plural(done.size)} to the Recycle Bin` + (keep.length ? ` (${keep.length} could not be deleted)` : ""));
    } catch (e) {
      setNotice(String(e));
    } finally {
      deleting.current = false;
    }
  };

  const shuffle = () => {
    setSeed((Math.random() * 2 ** 32) >>> 0);
    setSortKey("shuffle");
  };
  const edit = (it: Item | null) => it?.kind === "image" && setEditItem(it);

  const openMenu = useCallback(async (path: string | null, e: React.MouseEvent) => {
    const it = path ? sortedRef.current.find((i) => i.path === path) ?? null : null;
    const pos = { x: e.clientX, y: e.clientY };
    let canPaste = false;
    try {
      canPaste = (await invoke<ClipFiles>("clipboard_files")).paths.length > 0;
    } catch {
      /* no clipboard */
    }
    setMenu({ ...pos, item: it, canPaste });
  }, []);

  const onSort = useCallback((k: SortKey) => {
    setSortKey((cur) => {
      if (cur === k) setSortDesc((d) => !d);
      else setSortDesc(false);
      return k;
    });
  }, []);

  // grid columns, for ↑/↓
  const columns = () => {
    const cells = filesRef.current?.querySelectorAll<HTMLElement>("[data-path]");
    if (!cells || cells.length < 2) return 1;
    const top = cells[0].offsetTop;
    let n = 1;
    while (n < cells.length && cells[n].offsetTop === top) n++;
    return n;
  };

  const moveSel = (d: number, extend = false) => {
    if (!sorted.length) return;
    const i = sel ? sorted.indexOf(sel) : -1;
    const j = i < 0 ? 0 : Math.max(0, Math.min(sorted.length - 1, i + d));
    if (extend && anchor.current) {
      setSels(rangeTo(sorted[j].path, false));
      setSelPath(sorted[j].path);
    } else selectPaths([sorted[j].path]);
  };

  // ---------- keyboard ----------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || editItem) return;
    const t = e.target as HTMLElement;
    if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text")) return;
    if (menu) {
      if (e.key === "Escape") setMenu(null);
      return;
    }
    if (fs) {
      if (stageKeys.current?.(e)) {
        e.preventDefault();
        return;
      }
      if (e.key === "Escape" || e.key === "F11") setFullscreen(false);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "PageDown") step(10);
      else if (e.key === "PageUp") step(-10);
      else if (e.key === "Home" && media.length) selectPaths([media[0].path]);
      else if (e.key === "End" && media.length) selectPaths([media[media.length - 1].path]);
      else if (e.key === "Delete") del();
      else if (e.key === "BrowserBack") step(-1);
      else if (e.key === "BrowserForward") step(1);
      else return;
      e.preventDefault();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === "c") copySel(false);
    else if (ctrl && k === "x") copySel(true);
    else if (ctrl && k === "v") paste();
    else if (ctrl && k === "a") {
      setSels(new Set(sorted.map((i) => i.path)));
      anchor.current = sorted[0]?.path ?? null;
    } else if (ctrl && k === "e") edit(sel);
    else if (e.altKey && e.key === "ArrowLeft") back();
    else if (e.altKey && e.key === "ArrowRight") fwd();
    else if (e.altKey && e.key === "ArrowUp") up();
    else if (e.key === "ArrowRight") moveSel(1, e.shiftKey);
    else if (e.key === "ArrowLeft") moveSel(-1, e.shiftKey);
    else if (e.key === "ArrowDown") moveSel(view === "details" ? 1 : columns(), e.shiftKey);
    else if (e.key === "ArrowUp") moveSel(view === "details" ? -1 : -columns(), e.shiftKey);
    else if (e.key === "Home") moveSel(-1e9, e.shiftKey);
    else if (e.key === "End") moveSel(1e9, e.shiftKey);
    else if (e.key === "Enter" && sel) onOpen(sel);
    else if (e.key === "Backspace") up();
    else if (e.key === "F11") toggleFs();
    else if (e.key === "F5") refresh();
    else if (e.key === "Delete") del();
    else if (e.key === "BrowserBack") back();
    else if (e.key === "BrowserForward") fwd();
    else return;
    e.preventDefault();
  };
  // mouse side buttons: back / forward (fullscreen: previous / next picture)
  const sideRef = useRef<(b: number) => void>(() => {});
  sideRef.current = (b: number) => {
    if (editItem || menu) return;
    if (fs) step(b === 3 ? -1 : 1);
    else if (b === 3) back();
    else fwd();
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    // buttons 3/4 = side buttons; the webview would otherwise try a page history step
    const side = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === "mouseup") sideRef.current(e.button);
    };
    // clicked buttons/sliders must not keep focus (Space/arrows belong to the viewer)
    const blur = () => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && !(a.tagName === "INPUT" && (a as HTMLInputElement).type === "text") && a.tagName !== "SELECT") a.blur();
    };
    // no browser menu, except in text fields
    const ctx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!(t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text"))) e.preventDefault();
    };
    window.addEventListener("keydown", h);
    window.addEventListener("mousedown", side);
    window.addEventListener("mouseup", side);
    window.addEventListener("auxclick", side);
    window.addEventListener("mouseup", blur);
    window.addEventListener("contextmenu", ctx);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("mousedown", side);
      window.removeEventListener("mouseup", side);
      window.removeEventListener("auxclick", side);
      window.removeEventListener("mouseup", blur);
      window.removeEventListener("contextmenu", ctx);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---------- render ----------
  const viewValue = view !== "thumbs" ? view : PRESETS.reduce((best, p) => (Math.abs(p[1] - thumb) < Math.abs(best[1] - thumb) ? p : best))[0];
  const onViewChange = (v: string) => {
    if (v === "list" || v === "details") return setView(v);
    const p = PRESETS.find((x) => x[0] === v);
    if (p) {
      setThumb(p[1]);
      setView("thumbs");
    }
  };
  const px = bucket(view === "thumbs" ? thumb * (window.devicePixelRatio || 1) : 128);
  const nPics = media.filter((m) => m.kind === "image").length;
  const nVids = media.length - nPics;

  return (
    <div className="app">
      <div className="ribbon">
        <div className="navrow">
          <button className="nb" title="Back (Alt+←)" onClick={back}><IBack /></button>
          <button className="nb" title="Forward (Alt+→)" onClick={fwd}><IFwd /></button>
          <button className="nb" title="Up (Backspace)" onClick={up} disabled={!cwd}><IUp /></button>
          <button className="nb" title="Refresh (F5)" onClick={refresh}><IRefresh /></button>
          <input className="addr" value={addr === "" && cwd === "" ? "This PC" : addr} spellCheck={false}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                openPath(addr);
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setAddr(cwd ?? "");
                e.currentTarget.blur();
              }
            }} />
          <input className="filter" placeholder="Filter by name" value={filter} spellCheck={false}
            onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setFilter(""), e.currentTarget.blur())} />
        </div>
        <div className="groups">
          <div className="group">
            <div className="gbody">
              <select value={viewValue} onChange={(e) => { onViewChange(e.target.value); e.currentTarget.blur(); }}>
                {PRESETS.map(([n]) => <option key={n} value={n}>{n}</option>)}
                <option value="list">List</option>
                <option value="details">Details</option>
              </select>
              <input type="range" className="size" min={64} max={800} step={8} value={thumb} disabled={view !== "thumbs"}
                onChange={(e) => setThumb(+e.target.value)} title="Thumbnail size" />
              <span className="sizev">{thumb}px</span>
            </div>
            <div className="glabel">Layout</div>
          </div>
          <div className="group">
            <div className="gbody">
              <select value={sortKey} onChange={(e) => {
                const k = e.target.value as SortKey;
                if (k === "shuffle") shuffle();
                else setSortKey(k);
                e.currentTarget.blur();
              }}>
                {SORTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
              <button className="rb" title={sortDesc ? "Descending" : "Ascending"} onClick={() => setSortDesc(!sortDesc)}
                disabled={sortKey === "shuffle"}>
                {sortDesc ? <ISortDesc /> : <ISortAsc />}
                <span>{sortDesc ? "Desc" : "Asc"}</span>
              </button>
              <button className={"rb" + (sortKey === "shuffle" ? " active" : "")} onClick={shuffle} title="Random order (click again to reshuffle)">
                <IShuffle /><span>Shuffle</span>
              </button>
            </div>
            <div className="glabel">Sort by</div>
          </div>
          <div className="group">
            <div className="gbody">
              <button className={"rb picdata " + (picData ? "on" : "off")} onClick={() => setPicData(!picData)}
                title="Show picture properties on every picture">
                <IInfo /><span>pic data</span>
              </button>
            </div>
            <div className="glabel">Show</div>
          </div>
          <div className="group">
            <div className="gbody">
              <button className="rb" onClick={toggleFs} disabled={!media.length} title="Fullscreen (F11 / double-click)">
                <IFull /><span>Fullscreen</span>
              </button>
              <button className="rb" onClick={() => edit(sel)} disabled={sel?.kind !== "image"} title="Edit the selected picture (Ctrl+E)">
                <IEdit /><span>Edit</span>
              </button>
            </div>
            <div className="glabel">View</div>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="pane-tree" style={{ width: treeW }}>
          <Tree places={places} cwd={cwd ?? ""} onOpen={go} />
        </div>
        <Splitter onDrag={(dx, done) => {
          const w = Math.max(140, Math.min(600, load<number>("treeW", 230) + dx));
          setTreeW(w);
          if (done) save("treeW", w);
        }} />
        <div className="pane-files">
          {error && <div className="error">{error}</div>}
          <FileView items={sorted} meta={meta} view={view} thumb={thumb} gen={gen} picData={picData} selPath={selPath}
            sels={sels} cut={cutSet} onBlank={onBlank} onContext={openMenu}
            sortKey={sortKey} sortDesc={sortDesc} onSort={onSort} onSelect={onPick} onOpen={onOpen} onMeta={updateMeta}
            scrollRef={filesRef} empty={loading ? "Loading…" : filter ? "No matches" : "No pictures or videos here"} />
        </div>
        <Splitter onDrag={(dx, done) => {
          const max = window.innerWidth - treeW - 220;
          const w = Math.max(220, Math.min(max, load<number>("prevW", 520) - dx));
          setPrevW(w);
          if (done) save("prevW", w);
        }} />
        <div className="pane-preview" style={{ width: prevW }}>
          <Stage item={sel} meta={sel ? meta[sel.path] : undefined} picData={picData} fs={fs} index={mediaIdx} total={media.length}
            px={px} gen={gen} onPrev={() => step(-1)} onNext={() => step(1)} onToggleFs={toggleFs} onMeta={updateMeta}
            onWheel={onStageWheel} keysRef={stageKeys} />
        </div>
      </div>

      <div className="status">
        <span>{loading ? "Loading…" : `${sorted.length} items`}{sels.size > 1 ? ` · ${sels.size} selected` : ""}</span>
        <span>{nPics} pictures · {nVids} videos · {sorted.length - media.length} folders</span>
        {sel && sel.kind !== "dir" && <span className="status-sel">{sel.name} — {infoShort(sel, meta[sel.path])}</span>}
        {sel && sel.kind === "dir" && <span className="status-sel">{sel.name}</span>}
        {notice && <span className="status-notice">{notice}</span>}
        <span className="status-r">{media.length ? fmtSize(media.reduce((s, m) => s + m.size, 0)) : ""}</span>
      </div>

      {menu && (
        <div className="menu-veil" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="menu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 330) }}
            onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(null)}>
            {menu.item?.kind === "dir" && <button onClick={() => go(menu.item!.path)}>Open</button>}
            {menu.item && menu.item.kind !== "dir" && <button onClick={() => onOpen(menu.item!)}>View fullscreen</button>}
            {menu.item?.kind === "image" && <button onClick={() => edit(menu.item)}>Edit<kbd>Ctrl+E</kbd></button>}
            {menu.item && <hr />}
            {menu.item && <button onClick={() => copySel(true)}>Cut<kbd>Ctrl+X</kbd></button>}
            {menu.item && <button onClick={() => copySel(false)}>Copy<kbd>Ctrl+C</kbd></button>}
            {menu.item && <button onClick={del}>Delete<kbd>Del</kbd></button>}
            <button onClick={paste} disabled={!menu.canPaste || !cwd}>Paste<kbd>Ctrl+V</kbd></button>
            <hr />
            <button onClick={shuffle}>Shuffle</button>
            {menu.item && <button onClick={() => invoke("reveal", { path: menu.item!.path })}>Show in Explorer</button>}
            <button onClick={refresh}>Refresh<kbd>F5</kbd></button>
          </div>
        </div>
      )}

      {editItem && (
        <Editor key={editItem.path} item={editItem} onClose={() => setEditItem(null)}
          onSaved={(p) => cwdRef.current !== null && loadDir(cwdRef.current, p)} />
      )}
    </div>
  );
}

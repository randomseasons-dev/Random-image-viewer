import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Entry, Item, Meta, Place, SortKey, View, bucket, fmtSize, infoShort, load, normPath, parentOf, save, toItem } from "./lib";
import { clearVideoQueue } from "./videoThumbs";
import Tree from "./Tree";
import FileView from "./FileView";
import Stage from "./Stage";
import { IBack, IFull, IFwd, IInfo, IRefresh, ISortAsc, ISortDesc, IUp } from "./icons";
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
];
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

  // ---------- folder loading ----------
  const loadDir = useCallback(async (path: string, select?: string) => {
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
      setSelPath(select ?? null);
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
  }, []);

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
  const refresh = () => cwd !== null && loadDir(cwd, selPath ?? undefined);

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
    return () => {
      un.then((f) => f());
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
      if (c === 0) c = collator.compare(a.name, b.name);
      return c * sign;
    });
  }, [entries, filter, sortKey, sortDesc, dimsMeta]);

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
      setSelPath(media[0].path);
    }
    setFullscreen(true);
  };

  const step = (d: number) => {
    if (!media.length) return;
    const i = mediaIdx < 0 ? 0 : (mediaIdx + d + media.length) % media.length;
    setSelPath(media[i].path);
  };

  const onOpen = useCallback((it: Item) => {
    if (it.kind === "dir") go(it.path);
    else {
      setSelPath(it.path);
      setFullscreen(true);
    }
  }, [go, setFullscreen]);

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

  const moveSel = (d: number) => {
    if (!sorted.length) return;
    const i = sel ? sorted.indexOf(sel) : -1;
    const j = i < 0 ? 0 : Math.max(0, Math.min(sorted.length - 1, i + d));
    setSelPath(sorted[j].path);
  };

  // ---------- keyboard ----------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.tagName === "SELECT" || (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text")) return;
    if (fs) {
      if (e.key === "Escape" || e.key === "F11") setFullscreen(false);
      else if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
      else if (e.key === "Home" && media.length) setSelPath(media[0].path);
      else if (e.key === "End" && media.length) setSelPath(media[media.length - 1].path);
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey && e.key === "ArrowLeft") back();
    else if (e.altKey && e.key === "ArrowRight") fwd();
    else if (e.altKey && e.key === "ArrowUp") up();
    else if (e.key === "ArrowRight") moveSel(1);
    else if (e.key === "ArrowLeft") moveSel(-1);
    else if (e.key === "ArrowDown") moveSel(view === "details" ? 1 : columns());
    else if (e.key === "ArrowUp") moveSel(view === "details" ? -1 : -columns());
    else if (e.key === "Home") moveSel(-1e9);
    else if (e.key === "End") moveSel(1e9);
    else if (e.key === "Enter" && sel) onOpen(sel);
    else if (e.key === "Backspace") up();
    else if (e.key === "F11") toggleFs();
    else if (e.key === "F5") refresh();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    // clicked buttons/sliders must not keep focus (Space/arrows belong to the viewer)
    const blur = () => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && !(a.tagName === "INPUT" && (a as HTMLInputElement).type === "text") && a.tagName !== "SELECT") a.blur();
    };
    window.addEventListener("keydown", h);
    window.addEventListener("mouseup", blur);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("mouseup", blur);
    };
  }, []);

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
              <select value={sortKey} onChange={(e) => { setSortKey(e.target.value as SortKey); e.currentTarget.blur(); }}>
                {SORTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
              <button className="rb" title={sortDesc ? "Descending" : "Ascending"} onClick={() => setSortDesc(!sortDesc)}>
                {sortDesc ? <ISortDesc /> : <ISortAsc />}
                <span>{sortDesc ? "Desc" : "Asc"}</span>
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
            sortKey={sortKey} sortDesc={sortDesc} onSort={onSort} onSelect={setSelPath} onOpen={onOpen} onMeta={updateMeta}
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
            px={px} gen={gen} onPrev={() => step(-1)} onNext={() => step(1)} onToggleFs={toggleFs} onMeta={updateMeta} />
        </div>
      </div>

      <div className="status">
        <span>{loading ? "Loading…" : `${sorted.length} items`}</span>
        <span>{nPics} pictures · {nVids} videos · {sorted.length - media.length} folders</span>
        {sel && sel.kind !== "dir" && <span className="status-sel">{sel.name} — {infoShort(sel, meta[sel.path])}</span>}
        {sel && sel.kind === "dir" && <span className="status-sel">{sel.name}</span>}
        <span className="status-r">{media.length ? fmtSize(media.reduce((s, m) => s + m.size, 0)) : ""}</span>
      </div>
    </div>
  );
}

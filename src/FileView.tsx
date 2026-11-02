import { memo, useEffect, useState } from "react";
import { Item, Meta, SortKey, View, fmtDate, fmtDims, fmtDur, fmtSize, infoShort, typeName } from "./lib";
import { Thumb } from "./Thumb";

type Common = {
  gen: number;
  picData: boolean;
  onSelect: (path: string) => void;
  onOpen: (it: Item) => void;
  onMeta: (path: string, m: Meta) => void;
};

type Props = Common & {
  items: Item[];
  meta: Record<string, Meta>;
  view: View;
  thumb: number;
  selPath: string | null;
  sortKey: SortKey;
  sortDesc: boolean;
  onSort: (k: SortKey) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  empty: string;
};

type CellProps = Common & { item: Item; meta?: Meta; sel: boolean; thumb: number; px: number };

const Cell = memo(function Cell({ item, meta, sel, thumb, px, gen, picData, onSelect, onOpen, onMeta }: CellProps) {
  return (
    <div className={"cell" + (sel ? " sel" : "")} data-path={item.path} style={{ width: thumb + 14 }} title={item.name}
      onMouseDown={() => onSelect(item.path)} onDoubleClick={() => onOpen(item)}>
      <div className="cell-thumb" style={{ width: thumb, height: thumb }}>
        <Thumb item={item} px={px} gen={gen} onMeta={onMeta} />
        {item.kind === "video" && <div className="badge">▶</div>}
        {picData && item.kind !== "dir" && <div className="pd">{infoShort(item, meta)}</div>}
      </div>
      <div className="cell-name">{item.name}</div>
    </div>
  );
});

const Row = memo(function Row({ item, meta, sel, gen, picData, onSelect, onOpen, onMeta }: Omit<CellProps, "thumb" | "px">) {
  return (
    <div className={"lrow" + (sel ? " sel" : "")} data-path={item.path} title={item.name}
      onMouseDown={() => onSelect(item.path)} onDoubleClick={() => onOpen(item)}>
      <div className="licon"><Thumb item={item} px={128} gen={gen} onMeta={onMeta} /></div>
      <div className="lname">
        <span>{item.name}</span>
        {picData && item.kind !== "dir" && <span className="lpd">{infoShort(item, meta)}</span>}
      </div>
    </div>
  );
});

const DRow = memo(function DRow({ item, meta, sel, gen, onSelect, onOpen, onMeta }: Omit<CellProps, "thumb" | "px">) {
  return (
    <div className={"drow" + (sel ? " sel" : "")} data-path={item.path}
      onMouseDown={() => onSelect(item.path)} onDoubleClick={() => onOpen(item)}>
      <div className="dname" title={item.name}>
        <div className="licon"><Thumb item={item} px={128} gen={gen} onMeta={onMeta} /></div>
        <span>{item.name}</span>
      </div>
      <div>{fmtDate(item.modified)}</div>
      <div>{fmtDate(item.created)}</div>
      <div>{typeName(item)}</div>
      <div className="num">{item.kind === "dir" ? "" : fmtSize(item.size)}</div>
      <div className="num">{fmtDims(meta)}</div>
      <div className="num">{item.kind === "video" ? fmtDur(meta?.dur) : ""}</div>
    </div>
  );
});

const COLS: [SortKey | null, string][] = [
  ["name", "Name"],
  ["modified", "Date modified"],
  ["created", "Date created"],
  ["type", "Type"],
  ["size", "Size"],
  ["dims", "Dimensions"],
  [null, "Length"],
];

export default function FileView(p: Props) {
  const { items, meta, view, selPath, scrollRef } = p;
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  useEffect(() => {
    if (!selPath) return;
    scrollRef.current?.querySelector(`[data-path="${CSS.escape(selPath)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selPath, view, scrollRef]);

  // never wider than the pane
  const thumb = Math.max(48, Math.min(p.thumb, width - 40));
  const px = Math.round(thumb * (window.devicePixelRatio || 1));
  const common = { gen: p.gen, picData: p.picData, onSelect: p.onSelect, onOpen: p.onOpen, onMeta: p.onMeta };

  return (
    <div className={"files " + view} ref={scrollRef}>
      {items.length === 0 && <div className="files-empty">{p.empty}</div>}
      {view === "thumbs" && (
        <div className="grid">
          {items.map((it) => (
            <Cell key={it.path} item={it} meta={meta[it.path]} sel={it.path === selPath} thumb={thumb} px={px} {...common} />
          ))}
        </div>
      )}
      {view === "list" && (
        <div className="lgrid">
          {items.map((it) => (
            <Row key={it.path} item={it} meta={meta[it.path]} sel={it.path === selPath} {...common} />
          ))}
        </div>
      )}
      {view === "details" && items.length > 0 && (
        <div className="dtable">
          <div className="dhead">
            {COLS.map(([k, label]) => (
              <div key={label} className={k ? "sortable" : ""} onClick={() => k && p.onSort(k)}>
                {label}
                {k === p.sortKey && <span className="sorti">{p.sortDesc ? " ▼" : " ▲"}</span>}
              </div>
            ))}
          </div>
          {items.map((it) => (
            <DRow key={it.path} item={it} meta={meta[it.path]} sel={it.path === selPath} {...common} />
          ))}
        </div>
      )}
    </div>
  );
}

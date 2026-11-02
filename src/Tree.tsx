import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Entry, Place } from "./lib";
import { IDrive, IFolder, IPc } from "./icons";

type NodeProps = {
  name: string;
  path: string;
  depth: number;
  cwd: string;
  onOpen: (path: string) => void;
  icon?: React.ReactNode;
  fixedKids?: Place[];
  startOpen?: boolean;
};

function Node({ name, path, depth, cwd, onOpen, icon, fixedKids, startOpen }: NodeProps) {
  const [open, setOpen] = useState(!!startOpen);
  const [kids, setKids] = useState<Entry[] | null>(null);

  const toggle = async () => {
    if (!open && !fixedKids && kids === null) {
      try {
        setKids(await invoke<Entry[]>("list_subdirs", { path }));
      } catch {
        setKids([]);
      }
    }
    setOpen(!open);
  };

  const empty = !fixedKids && kids !== null && kids.length === 0;
  return (
    <>
      <div className={"tn" + (cwd === path ? " cur" : "")} style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onOpen(path)} title={path || name}>
        <span className="tw" onClick={(e) => { e.stopPropagation(); toggle(); }}>
          {empty ? "" : open ? "▾" : "▸"}
        </span>
        <span className="ti">{icon ?? <IFolder size={16} />}</span>
        <span className="tl">{name}</span>
      </div>
      {open && fixedKids?.map((k) => (
        <Node key={k.path} name={k.name} path={k.path} depth={depth + 1} cwd={cwd} onOpen={onOpen} icon={<IDrive size={16} />} />
      ))}
      {open && kids?.map((k) => (
        <Node key={k.path} name={k.name} path={k.path} depth={depth + 1} cwd={cwd} onOpen={onOpen} />
      ))}
    </>
  );
}

export default function Tree({ places, cwd, onOpen }: { places: Place[]; cwd: string; onOpen: (p: string) => void }) {
  const quick = places.filter((p) => p.kind === "quick");
  const drives = places.filter((p) => p.kind === "drive");
  return (
    <div className="tree">
      <div className="tree-sec">Quick access</div>
      {quick.map((p) => (
        <Node key={p.path} name={p.name} path={p.path} depth={0} cwd={cwd} onOpen={onOpen} />
      ))}
      <div className="tree-sec">Computer</div>
      {places.length > 0 && (
        <Node name="This PC" path="" depth={0} cwd={cwd} onOpen={onOpen} icon={<IPc size={16} />} fixedKids={drives} startOpen />
      )}
    </div>
  );
}

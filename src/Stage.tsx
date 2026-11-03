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
};

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

  const showUi = !fs || ui;
  const media = item && item.kind !== "dir";

  return (
    <div className={"stage" + (fs ? " fs" : "") + (showUi ? "" : " idle")} onMouseMove={poke}
      onWheel={(e) => fs && !(e.target as HTMLElement).closest(".vp-controls") && p.onWheel(e.deltaY)}
      onDoubleClick={(e) => item?.kind === "image" && (e.target as HTMLElement).classList.contains("stage-img") && p.onToggleFs()}>
      {!item && <div className="stage-empty">Select a picture or video</div>}
      {item?.kind === "dir" && (
        <div className="stage-empty"><IFolder size={96} /><div>{item.name}</div></div>
      )}
      {item?.kind === "image" && <StageImage key={item.path} item={item} px={p.px} gen={p.gen} onMeta={p.onMeta} />}
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
            <span className="fs-count">{p.index + 1} / {p.total}</span>
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

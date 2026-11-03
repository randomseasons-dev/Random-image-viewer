# Picture Viewer

Simple picture & video viewer for Windows (Tauri 2 + React).

- Folder tree on the left, thumbnails in the middle, preview on the right (drag the dividers to resize; the picture always fills the preview).
- Ribbon: Layout (Small → Huge thumbnails + size slider, List, Details), Sort by (name, dates, size, type, dimensions, asc/desc), **pic data** (green = show dimensions / size / type on every picture, also in fullscreen), Fullscreen.
- Fullscreen: `Esc` exits, `←` / `→` previous / next. Video controls and cursor hide after 3 s without mouse movement.
- Explorer actions: Ctrl+click / Shift+click / Ctrl+A multi-select, **Ctrl+C / Ctrl+X / Ctrl+V** copy and move files (shared with Windows Explorer's clipboard), right-click menu, **Shuffle** (random order, also in the ribbon; click again to reshuffle).
- **Editor** (right-click → Edit, or Ctrl+E): rectangle / free (lasso) / line (polygon) selection, crop, rotate 90° and flip, brush, mosaic brush and mosaic-selection, fill, text, color adjust (exposure, brightness, contrast, highlights, shadows, saturation, vibrance, warmth, tint), undo/redo, zoom/pan. Save copy (`name_edited.ext`) or overwrite.
- Video player: play/pause, ±5 s / ±10 s, seek bar, speed, volume, and an **A–B loop**: press **A** at the loop start, then **B** at the loop end — the section A→B repeats until you press B again or ✕.

## Formats

- Pictures: JPG, PNG, APNG, GIF, WebP, AVIF, BMP, ICO, SVG (shown by the webview) and TIFF, TGA, DDS, HDR, EXR, QOI, PNM/PBM/PGM/PPM/PAM, farbfeld (decoded in Rust).
- Videos: MP4, M4V, WebM, MOV, MKV, OGV, 3GP — whatever codecs WebView2 can play (H.264, VP8/VP9, AV1; HEVC only with the Windows HEVC extension). AVI / WMV / FLV are not supported.

## Keys

| Key | Action |
|---|---|
| Arrows / Home / End | move selection (Shift = extend) |
| Fullscreen: ← → / mouse wheel | previous / next |
| Fullscreen: PageUp / PageDown, Home / End | jump 10 back / forward, first / last |
| Ctrl+C / Ctrl+X / Ctrl+V, Ctrl+A | copy / cut / paste files, select all |
| Ctrl+E | edit picture |
| Enter / double-click | open folder / fullscreen |
| Backspace, Alt+↑ | parent folder |
| Alt+← / Alt+→ | back / forward |
| F11 | fullscreen, F5 refresh |
| Space / K | play / pause |
| J / L, Shift+← / Shift+→ | −10 / +10 s, −5 / +5 s |
| `[` / `]` / `\` | loop A / loop B / clear loop |
| M | mute |

## Build

```
npm install
CARGO_BUILD_JOBS=2 npx tauri build
```

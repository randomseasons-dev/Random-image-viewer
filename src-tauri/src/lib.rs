mod files;
mod thumbs;

use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    created: f64,
    modified: f64,
}

#[derive(Serialize)]
struct Place {
    name: String,
    path: String,
    kind: &'static str,
}

fn ms(t: std::io::Result<SystemTime>) -> f64 {
    t.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

#[cfg(windows)]
fn hidden(md: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    md.file_attributes() & 0x6 != 0 // HIDDEN | SYSTEM
}
#[cfg(not(windows))]
fn hidden(_md: &std::fs::Metadata) -> bool {
    false
}

// "C:" alone means "current dir of drive C", so always add the slash
fn norm(path: &str) -> String {
    let p = path.trim();
    if p.len() == 2 && p.ends_with(':') {
        format!("{p}\\")
    } else {
        p.to_string()
    }
}

fn read_entries(path: &str, dirs_only: bool) -> Result<Vec<Entry>, String> {
    let rd = std::fs::read_dir(path).map_err(|e| format!("{path}: {e}"))?;
    let mut out = Vec::new();
    for de in rd.flatten() {
        let Ok(mut md) = de.metadata() else { continue };
        if md.file_type().is_symlink() {
            match std::fs::metadata(de.path()) {
                Ok(m) => md = m,
                Err(_) => continue,
            }
        }
        if hidden(&md) {
            continue;
        }
        let is_dir = md.is_dir();
        if dirs_only && !is_dir {
            continue;
        }
        out.push(Entry {
            name: de.file_name().to_string_lossy().into_owned(),
            path: de.path().to_string_lossy().into_owned(),
            is_dir,
            size: if is_dir { 0 } else { md.len() },
            created: ms(md.created()),
            modified: ms(md.modified()),
        });
    }
    Ok(out)
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let path = norm(&path);
    tauri::async_runtime::spawn_blocking(move || read_entries(&path, false))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_subdirs(path: String) -> Result<Vec<Entry>, String> {
    let path = norm(&path);
    let mut v = tauri::async_runtime::spawn_blocking(move || read_entries(&path, true))
        .await
        .map_err(|e| e.to_string())??;
    v.sort_by_key(|e| e.name.to_lowercase());
    Ok(v)
}

#[tauri::command]
fn path_kind(path: String) -> &'static str {
    let p = norm(&path);
    let p = Path::new(&p);
    if p.is_dir() {
        "dir"
    } else if p.is_file() {
        "file"
    } else {
        "none"
    }
}

#[tauri::command]
fn get_places() -> Vec<Place> {
    let mut v = Vec::new();
    let quick = [
        ("Desktop", dirs::desktop_dir()),
        ("Downloads", dirs::download_dir()),
        ("Documents", dirs::document_dir()),
        ("Pictures", dirs::picture_dir()),
        ("Videos", dirs::video_dir()),
        ("Home", dirs::home_dir()),
    ];
    for (name, p) in quick {
        if let Some(p) = p.filter(|p| p.is_dir()) {
            v.push(Place { name: name.into(), path: p.to_string_lossy().into_owned(), kind: "quick" });
        }
    }
    #[cfg(windows)]
    for c in b'A'..=b'Z' {
        let p = format!("{}:\\", c as char);
        if Path::new(&p).exists() {
            v.push(Place { name: format!("{}:", c as char), path: p, kind: "drive" });
        }
    }
    v
}

// EXIF orientation of a JPEG (1..8), read from the first 64 KB only
fn jpeg_orientation(path: &str) -> Option<u16> {
    let mut buf = Vec::with_capacity(65536);
    File::open(path).ok()?.take(65536).read_to_end(&mut buf).ok()?;
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 {
        return None;
    }
    let mut i = 2;
    while i + 4 <= buf.len() {
        if buf[i] != 0xFF {
            return None;
        }
        let marker = buf[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if marker == 0x01 || (0xD0..=0xD8).contains(&marker) {
            i += 2;
            continue;
        }
        if marker == 0xDA {
            return None;
        }
        let len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        if marker == 0xE1 {
            let seg = &buf[(i + 4).min(buf.len())..(i + 2 + len).min(buf.len())];
            if let Some(tiff) = seg.strip_prefix(b"Exif\0\0") {
                return tiff_orientation(tiff);
            }
        }
        i += 2 + len;
    }
    None
}

fn tiff_orientation(t: &[u8]) -> Option<u16> {
    let le = match t.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let r16 = |o: usize| -> Option<u16> {
        let b = t.get(o..o + 2)?;
        Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    let r32 = |o: usize| -> Option<u32> {
        let b = t.get(o..o + 4)?;
        let a = [b[0], b[1], b[2], b[3]];
        Some(if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) })
    };
    let ifd = r32(4)? as usize;
    let n = r16(ifd)? as usize;
    for k in 0..n {
        let e = ifd + 2 + k * 12;
        if r16(e)? == 0x0112 {
            return r16(e + 8);
        }
    }
    None
}

fn dims_of(path: &str) -> Option<(usize, usize)> {
    let s = imagesize::size(path).ok()?;
    let lower = path.to_lowercase();
    let jpeg = [".jpg", ".jpeg", ".jpe", ".jfif", ".pjpeg", ".pjp"].iter().any(|e| lower.ends_with(e));
    if jpeg && jpeg_orientation(path).is_some_and(|o| o >= 5) {
        return Some((s.height, s.width));
    }
    Some((s.width, s.height))
}

#[tauri::command]
async fn get_dims(paths: Vec<String>) -> Vec<Option<(usize, usize)>> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| dims_of(p)).collect())
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn set_gen(g: u64) {
    thumbs::GEN.store(g, Ordering::Relaxed);
}

#[tauri::command]
fn startup_path() -> Option<String> {
    std::env::args().nth(1).filter(|a| Path::new(a).exists())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // a second launch (double-clicking another picture) hands its file to this window
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(p) = argv.get(1).filter(|a| Path::new(a).exists()) {
                let _ = app.emit("open-path", p.clone());
            }
        }))
        .setup(|app| {
            let cache = app.path().app_cache_dir()?.join("thumbs");
            thumbs::init(cache);
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("thumb", |_ctx, req, responder| {
            let path = req.uri().path().to_string();
            let query = req.uri().query().unwrap_or("").to_string();
            thumbs::submit(Box::new(move || responder.respond(thumbs::respond(&path, &query))));
        })
        .invoke_handler(tauri::generate_handler![
            list_dir,
            list_subdirs,
            path_kind,
            get_places,
            get_dims,
            set_gen,
            startup_path,
            files::clipboard_set,
            files::clipboard_files,
            files::paste_files,
            files::save_image,
            files::reveal,
            files::recycle
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

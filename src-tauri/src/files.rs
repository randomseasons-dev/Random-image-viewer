// File operations: Windows clipboard (shared with Explorer), paste (copy/move), saving edited images.

use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Default)]
pub struct ClipFiles {
    paths: Vec<String>,
    cut: bool,
}

#[cfg(windows)]
mod clip {
    use clipboard_win::{raw, Clipboard};

    const CF_HDROP: u32 = 15;
    const DROPEFFECT_COPY_LINK: u32 = 5; // what Explorer writes for Ctrl+C
    const DROPEFFECT_MOVE: u32 = 2;

    fn effect_format() -> Option<u32> {
        raw::register_format("Preferred DropEffect").map(|f| f.get())
    }

    pub fn set(paths: &[String], cut: bool) -> Result<(), String> {
        let _c = Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
        raw::empty().map_err(|e| e.to_string())?;
        raw::set_file_list(paths).map_err(|e| e.to_string())?;
        if let Some(f) = effect_format() {
            let eff = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY_LINK };
            raw::set_without_clear(f, &eff.to_le_bytes()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn get() -> super::ClipFiles {
        let Ok(_c) = Clipboard::new_attempts(10) else { return Default::default() };
        if !raw::is_format_avail(CF_HDROP) {
            return Default::default();
        }
        let mut paths = Vec::new();
        let _ = raw::get_file_list(&mut paths);
        let cut = effect_format()
            .and_then(|f| {
                let mut b = [0u8; 4];
                raw::get(f, &mut b).ok().filter(|n| *n >= 4).map(|_| u32::from_le_bytes(b) & DROPEFFECT_MOVE != 0)
            })
            .unwrap_or(false);
        super::ClipFiles { paths, cut }
    }

    pub fn clear() {
        if let Ok(_c) = Clipboard::new_attempts(10) {
            let _ = raw::empty();
        }
    }
}

#[cfg(not(windows))]
mod clip {
    pub fn set(_: &[String], _: bool) -> Result<(), String> {
        Err("clipboard not supported".into())
    }
    pub fn get() -> super::ClipFiles {
        Default::default()
    }
    pub fn clear() {}
}

#[tauri::command]
pub fn clipboard_set(paths: Vec<String>, cut: bool) -> Result<(), String> {
    clip::set(&paths, cut)
}

#[tauri::command]
pub fn clipboard_files() -> ClipFiles {
    clip::get()
}

/// `dir\stem<suffix>.ext`, then `dir\stem<suffix> (2).ext`, ... — first name that does not exist
fn free_name(dir: &Path, file_name: &str, suffix: &str) -> PathBuf {
    let p = Path::new(file_name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let first = dir.join(format!("{stem}{suffix}{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem}{suffix} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

fn copy_any(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir(dst)?;
        for de in fs::read_dir(src)? {
            let de = de?;
            copy_any(&de.path(), &dst.join(de.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

fn paste_one(src: &Path, dest: &Path, mv: bool) -> Result<Option<PathBuf>, String> {
    let name = src.file_name().ok_or("bad path")?.to_string_lossy().into_owned();
    let same_dir = src.parent().is_some_and(|p| p == dest);
    if mv && same_dir {
        return Ok(None);
    }
    if src.is_dir() && dest.starts_with(src) {
        return Err(format!("Can't put \"{name}\" inside itself"));
    }
    let target = free_name(dest, &name, if same_dir { " - Copy" } else { "" });
    let err = |e: std::io::Error| format!("{name}: {e}");
    if mv {
        if fs::rename(src, &target).is_err() {
            // other drive: copy, then delete the original
            copy_any(src, &target).map_err(err)?;
            if src.is_dir() { fs::remove_dir_all(src) } else { fs::remove_file(src) }.map_err(err)?;
        }
    } else {
        copy_any(src, &target).map_err(err)?;
    }
    Ok(Some(target))
}

/// Copies (or moves) every path into `dest`; returns the new paths. Stops at the first error.
#[tauri::command]
pub async fn paste_files(dest: String, paths: Vec<String>, mv: bool) -> Result<Vec<String>, String> {
    let out = tauri::async_runtime::spawn_blocking(move || {
        let dest = PathBuf::from(dest);
        let mut out = Vec::new();
        for p in &paths {
            if let Some(t) = paste_one(Path::new(p), &dest, mv)? {
                out.push(t.to_string_lossy().into_owned());
            }
        }
        Ok::<_, String>(out)
    })
    .await
    .map_err(|e| e.to_string())??;
    if mv {
        clip::clear();
    }
    Ok(out)
}

/// Body = encoded image bytes. Headers: `x-path` (URI-encoded target), `x-unique: 1` = never overwrite.
#[tauri::command]
pub async fn save_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let path = PathBuf::from(percent_decode_str(&header("x-path")).decode_utf8_lossy().into_owned());
    let target = if header("x-unique") == "1" {
        let dir = path.parent().ok_or("bad path")?;
        let name = path.file_name().ok_or("bad path")?.to_string_lossy().into_owned();
        free_name(dir, &name, "")
    } else {
        path
    };
    fs::write(&target, data).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn reveal(path: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer").raw_arg(format!("/select,\"{path}\"")).spawn();
    }
    #[cfg(not(windows))]
    let _ = path;
}

/// Sends files/folders to the Recycle Bin (never a silent permanent delete:
/// Windows asks first when an item can't be recycled). Returns the paths that are gone.
#[tauri::command]
pub async fn recycle(window: tauri::WebviewWindow, paths: Vec<String>) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    let owner = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let _ = window;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::Shell::{SHFileOperationW, SHFILEOPSTRUCTW};
            const FO_DELETE: u32 = 3;
            const FOF_SILENT: u16 = 0x4;
            const FOF_NOCONFIRMATION: u16 = 0x10;
            const FOF_ALLOWUNDO: u16 = 0x40;
            const FOF_WANTNUKEWARNING: u16 = 0x4000;
            // double-null-terminated list
            let mut from: Vec<u16> = Vec::new();
            for p in &paths {
                from.extend(p.encode_utf16());
                from.push(0);
            }
            from.push(0);
            let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
            op.hwnd = owner as _;
            op.wFunc = FO_DELETE as _;
            op.pFrom = from.as_ptr();
            op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING | FOF_SILENT) as _;
            let r = unsafe { SHFileOperationW(&mut op) };
            let gone: Vec<String> = paths.into_iter().filter(|p| !Path::new(p).exists()).collect();
            if gone.is_empty() && r != 0 && op.fAnyOperationsAborted == 0 {
                return Err(format!("Delete failed (code {r})"));
            }
            Ok(gone)
        }
        #[cfg(not(windows))]
        {
            let _ = paths;
            Err("not supported".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

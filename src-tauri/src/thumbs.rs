// thumb:// protocol — thumbnails (w > 0, disk-cached) and full-size PNG conversion (w = 0)
// for formats the webview cannot show by itself (TIFF, TGA, EXR, ...)

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, ImageReader};
use percent_encoding::percent_decode_str;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::http::{header, Response, StatusCode};

/// Folder generation: thumbnail requests from an older folder visit are dropped unprocessed.
pub static GEN: AtomicU64 = AtomicU64::new(0);

static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

type Job = Box<dyn FnOnce() + Send>;
static POOL: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();

pub fn init(cache: PathBuf) {
    let _ = fs::create_dir_all(&cache);
    let old = cache.clone();
    thread::spawn(move || prune(old, Duration::from_secs(60 * 24 * 3600)));
    let _ = CACHE_DIR.set(cache);

    let (tx, rx) = mpsc::channel::<Job>();
    let rx = Arc::new(Mutex::new(rx));
    let n = thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    for _ in 0..(n / 2).clamp(2, 4) {
        let rx = rx.clone();
        thread::spawn(move || loop {
            let job = rx.lock().unwrap().recv();
            match job {
                Ok(job) => job(),
                Err(_) => break,
            }
        });
    }
    let _ = POOL.set(Mutex::new(tx));
}

pub fn submit(job: Job) {
    match POOL.get() {
        Some(p) => {
            let _ = p.lock().unwrap().send(job);
        }
        None => job(),
    }
}

fn prune(dir: PathBuf, max_age: Duration) {
    let Ok(rd) = fs::read_dir(&dir) else { return };
    let now = SystemTime::now();
    for de in rd.flatten() {
        let old = de
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > max_age);
        if old {
            let _ = fs::remove_file(de.path());
        }
    }
}

pub fn respond(path_enc: &str, query: &str) -> Response<Vec<u8>> {
    let path = percent_decode_str(path_enc.trim_start_matches('/')).decode_utf8_lossy().into_owned();
    let (mut w, mut g) = (0u32, 0u64);
    for kv in query.split('&') {
        match kv.split_once('=') {
            Some(("w", v)) => w = v.parse().unwrap_or(0),
            Some(("g", v)) => g = v.parse().unwrap_or(0),
            _ => {}
        }
    }
    if g != 0 && g < GEN.load(Ordering::Relaxed) {
        return Response::builder().status(StatusCode::GONE).body(Vec::new()).unwrap();
    }
    match make(&path, w) {
        Ok((bytes, mime)) => Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "max-age=3600")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(bytes)
            .unwrap(),
        Err(e) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header(header::CONTENT_TYPE, "text/plain")
            .body(e.into_bytes())
            .unwrap(),
    }
}

fn make(path: &str, w: u32) -> Result<(Vec<u8>, &'static str), String> {
    if w == 0 {
        return Ok((encode_png(&load(path)?)?, "image/png"));
    }
    let md = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    md.len().hash(&mut h);
    md.modified().ok().hash(&mut h);
    w.hash(&mut h);
    let key = format!("{:016x}", h.finish());
    let dir = CACHE_DIR.get();
    if let Some(dir) = dir {
        for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
            if let Ok(b) = fs::read(dir.join(format!("{key}.{ext}"))) {
                return Ok((b, mime));
            }
        }
    }
    let img = load(path)?;
    let t = if img.width() > w || img.height() > w { img.thumbnail(w, w) } else { img };
    let (bytes, ext, mime) = if t.color().has_alpha() {
        (encode_png(&t)?, "png", "image/png")
    } else {
        (encode_jpeg(&t)?, "jpg", "image/jpeg")
    };
    if let Some(dir) = dir {
        let _ = fs::write(dir.join(format!("{key}.{ext}")), &bytes);
    }
    Ok((bytes, mime))
}

fn load(path: &str) -> Result<DynamicImage, String> {
    let es = |e: image::ImageError| e.to_string();
    let mut reader = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    reader.no_limits();
    let mut dec = reader.into_decoder().map_err(es)?;
    let orient = dec.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(dec).map_err(es)?;
    img.apply_orientation(orient);
    Ok(img)
}

fn encode_jpeg(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    JpegEncoder::new_with_quality(&mut buf, 85).encode_image(&rgb).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn encode_png(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let rgba = img.to_rgba8();
    let mut buf = Vec::new();
    PngEncoder::new_with_quality(&mut buf, CompressionType::Fast, FilterType::Adaptive)
        .write_image(rgba.as_raw(), rgba.width(), rgba.height(), ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

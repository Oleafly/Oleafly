use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use base64::Engine as _;

use super::apps::InstalledApp;
use super::lock;

#[cfg_attr(target_os = "linux", allow(dead_code))]
const EDGE: u32 = 64;
const MAX_ICON_BYTES: u64 = 512 * 1024;
pub(crate) const MAX_ICONS_PER_CALL: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum IconSource {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Bundle(PathBuf),
    /// Windows: the program, whose first icon is the app's.
    Program(PathBuf),
    /// Linux: the desktop entry's `Icon=`, a theme name or an absolute path.
    Named(String),
}

#[derive(Default)]
struct Icons {
    sources: HashMap<String, IconSource>,
    loaded: HashMap<String, Option<String>>,
}

static ICONS: LazyLock<Mutex<Icons>> = LazyLock::new(Mutex::default);

pub(crate) fn row_key(app: &InstalledApp) -> String {
    let identity = app
        .bundle_id
        .as_deref()
        .or(app.executable.as_deref())
        .unwrap_or_default();
    format!("{}\u{0}{identity}", app.name)
}

pub(crate) fn remember(apps: &[InstalledApp]) {
    let sources: HashMap<String, IconSource> = apps
        .iter()
        .filter_map(|app| Some((row_key(app), app.icon.clone()?)))
        .collect();
    let mut icons = lock(&ICONS);
    icons.loaded.retain(|key, _| sources.contains_key(key));
    icons.sources = sources;
}

pub(crate) fn icons_for(keys: &[String]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    for key in keys.iter().take(MAX_ICONS_PER_CALL) {
        let (source, known) = {
            let icons = lock(&ICONS);
            (
                icons.sources.get(key).cloned(),
                icons.loaded.get(key).cloned(),
            )
        };
        let Some(source) = source else {
            continue;
        };
        let url = match known {
            Some(url) => url,
            None => {
                let url = load(&source);
                lock(&ICONS).loaded.insert(key.clone(), url.clone());
                url
            }
        };
        if let Some(url) = url {
            found.insert(key.clone(), url);
        }
    }
    found
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn load(source: &IconSource) -> Option<String> {
    match source {
        IconSource::Bundle(bundle) => bundle_icon(bundle).map(|png| data_url("image/png", &png)),
        IconSource::Program(program) => {
            program_icon(program).map(|png| data_url("image/png", &png))
        }
        IconSource::Named(name) => {
            let env = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
            let path = named_icon_path(name, &icon_dirs(&env))?;
            let bytes = read_small(&path)?;
            let mime = if path.extension().is_some_and(|ext| ext == "svg") {
                "image/svg+xml"
            } else {
                "image/png"
            };
            Some(data_url(mime, &bytes))
        }
    }
}

/// macOS: the icon Finder shows, drawn into an `EDGE` px square. Works for
/// apps that keep their icon only in an asset catalog, which have no `.icns`.
#[cfg(target_os = "macos")]
fn bundle_icon(bundle: &Path) -> Option<Vec<u8>> {
    use objc2::rc::autoreleasepool;
    use objc2::AllocAnyThread as _;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace,
        NSGraphicsContext, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    let path = bundle.to_str()?;
    let edge = isize::try_from(EDGE).ok()?;
    autoreleasepool(|_| {
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path));
        // SAFETY: a null planes pointer makes the rep allocate its own pixels,
        // and the colour space name is AppKit's own constant.
        let rep = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                std::ptr::null_mut(),
                edge,
                edge,
                8,
                4,
                true,
                false,
                NSDeviceRGBColorSpace,
                0,
                0,
            )
        }?;
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        let side = f64::from(EDGE);
        image.drawInRect_fromRect_operation_fraction(
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(side, side)),
            NSRect::ZERO,
            NSCompositingOperation::Copy,
            1.0,
        );
        context.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        // SAFETY: an empty dictionary is a valid set of PNG properties.
        let png = unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }?;
        Some(png.to_vec())
    })
}

#[cfg(not(target_os = "macos"))]
fn bundle_icon(_bundle: &Path) -> Option<Vec<u8>> {
    None
}

#[cfg(windows)]
fn program_icon(program: &Path) -> Option<Vec<u8>> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::UI::Shell::SHDefExtractIconW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    let wide: Vec<u16> = program.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut icon: HICON = std::ptr::null_mut();
    // SAFETY: `wide` is a NUL-terminated path that outlives the call, and
    // only the large icon is asked for.
    let result =
        unsafe { SHDefExtractIconW(wide.as_ptr(), 0, 0, &mut icon, std::ptr::null_mut(), EDGE) };
    if result != 0 || icon.is_null() {
        return None;
    }
    let image = icon_pixels(icon);
    // SAFETY: the icon came from SHDefExtractIconW and is used no more.
    unsafe { DestroyIcon(icon) };
    crate::app_icon::encode_png(&image?)
}

#[cfg(windows)]
fn icon_pixels(
    icon: windows_sys::Win32::UI::WindowsAndMessaging::HICON,
) -> Option<crate::app_icon::Rgba> {
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let side = EDGE as usize;
    let read = |dc: HDC, bitmap: HBITMAP| -> Option<Vec<u8>> {
        let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: EDGE as i32,
            biHeight: -(EDGE as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..unsafe { std::mem::zeroed() }
        };
        let mut pixels = vec![0u8; side * side * 4];
        // SAFETY: `pixels` holds EDGE rows of EDGE 32-bit pixels, as `info` says.
        let rows = unsafe {
            GetDIBits(
                dc,
                bitmap,
                0,
                EDGE,
                pixels.as_mut_ptr().cast(),
                &mut info,
                DIB_RGB_COLORS,
            )
        };
        (rows == EDGE as i32).then_some(pixels)
    };

    let mut parts: ICONINFO = unsafe { std::mem::zeroed() };
    // SAFETY: `icon` is a live icon handle and `parts` is written in full.
    if unsafe { GetIconInfo(icon, &mut parts) } == 0 {
        return None;
    }
    // SAFETY: a memory DC for the current screen, deleted below.
    let dc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
    let colour = (!parts.hbmColor.is_null())
        .then(|| read(dc, parts.hbmColor))
        .flatten();
    let mask = (!parts.hbmMask.is_null())
        .then(|| read(dc, parts.hbmMask))
        .flatten();
    // SAFETY: GetIconInfo hands over both bitmaps; the DC is ours.
    unsafe {
        DeleteObject(parts.hbmColor);
        DeleteObject(parts.hbmMask);
        DeleteDC(dc);
    }
    let mut pixels = colour?;
    let has_alpha = pixels.as_chunks::<4>().0.iter().any(|pixel| pixel[3] != 0);
    for (at, pixel) in pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        pixel.swap(0, 2);
        if !has_alpha {
            let shown = mask.as_ref().is_some_and(|mask| mask[at * 4] == 0);
            pixel[3] = if shown { 255 } else { 0 };
        }
    }
    Some(crate::app_icon::Rgba {
        pixels,
        width: EDGE,
        height: EDGE,
    })
}

#[cfg(not(windows))]
fn program_icon(_program: &Path) -> Option<Vec<u8>> {
    None
}

/// Linux: the folders icon themes and pixmaps live in, most specific first.
pub(crate) fn icon_dirs(env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut data = Vec::new();
    if let Some(home) =
        env("XDG_DATA_HOME").or_else(|| env("HOME").map(|home| format!("{home}/.local/share")))
    {
        data.push(PathBuf::from(home));
    }
    let shared = env("XDG_DATA_DIRS").unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    data.extend(
        shared
            .split(':')
            .filter(|dir| dir.starts_with('/'))
            .map(PathBuf::from),
    );
    let mut dirs = Vec::new();
    if let Some(home) = env("HOME") {
        dirs.push(Path::new(&home).join(".icons"));
    }
    dirs.extend(data.iter().map(|dir| dir.join("icons")));
    dirs.extend(data.iter().map(|dir| dir.join("pixmaps")));
    dirs.dedup();
    dirs
}

/// Linux: the file for an `Icon=` value, from the hicolor theme every app
/// installs into, or from pixmaps.
pub(crate) fn named_icon_path(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let usable = |path: &Path| {
        path.extension()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|ext| matches!(ext, "png" | "svg"))
            && std::fs::metadata(path)
                .is_ok_and(|meta| meta.is_file() && meta.len() <= MAX_ICON_BYTES)
    };
    let name = name.trim();
    if name.starts_with('/') {
        let path = PathBuf::from(name);
        return usable(&path).then_some(path);
    }
    if name.is_empty() || name.contains('/') || name.starts_with('.') {
        return None;
    }
    const SIZES: [&str; 7] = [
        "64x64", "48x48", "96x96", "128x128", "256x256", "32x32", "scalable",
    ];
    for dir in dirs {
        let candidates: Vec<PathBuf> = if dir.ends_with("pixmaps") {
            vec![
                dir.join(format!("{name}.png")),
                dir.join(format!("{name}.svg")),
            ]
        } else {
            SIZES
                .iter()
                .flat_map(|size| {
                    let apps = dir.join("hicolor").join(size).join("apps");
                    [
                        apps.join(format!("{name}.png")),
                        apps.join(format!("{name}.svg")),
                    ]
                })
                .collect()
        };
        if let Some(found) = candidates.into_iter().find(|path| usable(path)) {
            return Some(found);
        }
    }
    None
}

fn read_small(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read as _;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_ICON_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= MAX_ICON_BYTES).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(
        name: &str,
        bundle_id: Option<&str>,
        executable: Option<&str>,
        icon: Option<IconSource>,
    ) -> InstalledApp {
        InstalledApp {
            name: name.into(),
            bundle_id: bundle_id.map(str::to_string),
            executable: executable.map(str::to_string),
            blocked: None,
            icon,
        }
    }

    #[test]
    fn row_keys_match_the_pickers() {
        assert_eq!(
            row_key(&app("TextEdit", Some("com.apple.TextEdit"), None, None)),
            "TextEdit\u{0}com.apple.TextEdit"
        );
        assert_eq!(
            row_key(&app(
                "Writer",
                None,
                Some("/usr/lib/libreoffice/program/soffice"),
                None
            )),
            "Writer\u{0}/usr/lib/libreoffice/program/soffice"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn only_listed_apps_get_an_icon() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("zotero.png");
        std::fs::write(&file, b"\x89PNG fake").unwrap();
        let listed = app(
            "Zotero",
            None,
            Some("/usr/bin/zotero"),
            Some(IconSource::Named(file.to_string_lossy().into_owned())),
        );
        remember(std::slice::from_ref(&listed));
        let key = row_key(&listed);
        let icons = icons_for(&[key.clone(), "Other\u{0}/usr/bin/other".into()]);
        assert_eq!(icons.len(), 1);
        assert!(
            icons[&key].starts_with("data:image/png;base64,"),
            "{}",
            icons[&key]
        );
        remember(&[]);
        assert!(icons_for(&[key]).is_empty());
    }

    #[cfg(not(windows))]
    #[test]
    fn linux_icons_come_from_hicolor_then_pixmaps() {
        let root = tempfile::tempdir().unwrap();
        let share = root.path().join("share");
        let hicolor = share.join("icons/hicolor/48x48/apps");
        let scalable = share.join("icons/hicolor/scalable/apps");
        let pixmaps = share.join("pixmaps");
        for dir in [&hicolor, &scalable, &pixmaps] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(hicolor.join("zotero.png"), b"png").unwrap();
        std::fs::write(scalable.join("zotero.svg"), b"<svg/>").unwrap();
        std::fs::write(pixmaps.join("stata.png"), b"png").unwrap();
        std::fs::write(
            pixmaps.join("big.png"),
            vec![0u8; (MAX_ICON_BYTES + 1) as usize],
        )
        .unwrap();
        let home = root.path().join("home");
        let env = |name: &str| match name {
            "HOME" => Some(home.to_string_lossy().into_owned()),
            "XDG_DATA_DIRS" => Some(share.to_string_lossy().into_owned()),
            _ => None,
        };
        let dirs = icon_dirs(&env);
        assert_eq!(
            named_icon_path("zotero", &dirs),
            Some(hicolor.join("zotero.png"))
        );
        assert_eq!(
            named_icon_path("stata", &dirs),
            Some(pixmaps.join("stata.png"))
        );
        assert_eq!(named_icon_path("big", &dirs), None);
        assert_eq!(named_icon_path("missing", &dirs), None);
        assert_eq!(named_icon_path("../pixmaps/stata", &dirs), None);
        let absolute = pixmaps.join("stata.png");
        assert_eq!(
            named_icon_path(&absolute.to_string_lossy(), &dirs),
            Some(absolute)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_draws_an_apps_icon_as_a_small_png() {
        let png = bundle_icon(Path::new("/System/Applications/TextEdit.app")).unwrap();
        let image = crate::app_icon::decode_png(&png).unwrap();
        assert_eq!((image.width, image.height), (EDGE, EDGE));
        assert!(image
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[3] != 0));
    }
}

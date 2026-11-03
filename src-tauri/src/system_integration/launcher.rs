//! The AppImage's own entry in the applications menu.
//!
//! Wayland desktops never use a window's icon: GNOME and KDE match the window's app id to a
//! desktop entry and draw that entry's icon. A .deb or .rpm installs one. An AppImage nobody
//! added to the menu has none, so its windows get a generic icon in the dock and taskbar.

use super::file_manager::{
    desktop_value, exec_argument, remove_file, write_file, APPLICATIONS_DIR,
};
use std::path::{Path, PathBuf};

/// Marks the entries Oleafly writes, so it only ever changes or removes its own.
pub(crate) const MARKER: &str = "X-Oleafly-AppImage=true";
const BUNDLED: &str = include_str!("../../linux/appimage.desktop");
const ICON_NAME: &str = "oleafly-desktop";
#[cfg(any(target_os = "linux", all(test, unix)))]
const DEFAULT_DATA_DIRS: [&str; 2] = ["/usr/local/share", "/usr/share"];

#[derive(Clone, Debug)]
pub(crate) struct Launcher {
    pub(crate) appimage: String,
    pub(crate) app_id: String,
    pub(crate) data_home: PathBuf,
    pub(crate) data_dirs: Vec<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    Written,
    Current,
    /// Another entry already serves this app, such as the one an installed package ships.
    Elsewhere,
    /// The person removed the entry Oleafly wrote earlier.
    Removed,
}

impl Launcher {
    pub(crate) fn entry_path(&self) -> PathBuf {
        self.data_home
            .join(APPLICATIONS_DIR)
            .join(format!("{}.desktop", self.app_id))
    }

    pub(crate) fn icon_path(&self, edge: u32) -> PathBuf {
        self.data_home
            .join(format!("icons/hicolor/{edge}x{edge}/apps/{ICON_NAME}.png"))
    }
}

/// The system data folders, without the ones inside the mounted AppImage: its AppRun puts its
/// own `usr/share` first, and the entry in there would look like an installed package.
#[cfg(any(target_os = "linux", all(test, unix)))]
pub(crate) fn host_data_dirs(
    xdg_data_dirs: Option<std::ffi::OsString>,
    appdir: Option<&Path>,
) -> Vec<PathBuf> {
    let dirs: Vec<PathBuf> = xdg_data_dirs
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|dir| dir.is_absolute() && appdir.is_none_or(|appdir| !dir.starts_with(appdir)))
        .collect();
    if dirs.is_empty() {
        DEFAULT_DATA_DIRS.iter().map(PathBuf::from).collect()
    } else {
        dirs
    }
}

pub(crate) fn png_edge(png: &[u8]) -> Option<u32> {
    let side = |at: usize| Some(u32::from_be_bytes(png.get(at..at + 4)?.try_into().ok()?));
    let (width, height) = (side(16)?, side(20)?);
    (png.starts_with(b"\x89PNG\r\n\x1a\n") && width == height && width > 0).then_some(width)
}

/// The bundled AppImage entry, pointed at this AppImage file and this icon.
pub(crate) fn entry(appimage: &str, app_id: &str, icon: &Path) -> String {
    let mut text = String::new();
    for line in BUNDLED.lines() {
        if line.starts_with("Exec=") {
            let exec = format!("{} %F", exec_argument(appimage));
            text.push_str(&format!("Exec={}\n", desktop_value(&exec)));
            // Hides the entry once the AppImage is moved or deleted.
            text.push_str(&format!("TryExec={}\n", desktop_value(appimage)));
        } else if line.starts_with("StartupWMClass=") {
            text.push_str(&format!("StartupWMClass={}\n", desktop_value(app_id)));
        } else if line.starts_with("Icon=") {
            text.push_str(&format!(
                "Icon={}\n",
                desktop_value(&icon.to_string_lossy())
            ));
        } else {
            text.push_str(line);
            text.push('\n');
        }
    }
    text.push_str(MARKER);
    text.push('\n');
    text
}

fn serves(path: &Path, text: &str, app_id: &str) -> bool {
    path.file_stem().is_some_and(|stem| stem == app_id)
        || text
            .lines()
            .any(|line| line.strip_prefix("StartupWMClass=") == Some(app_id))
}

fn served_elsewhere(launcher: &Launcher, ours: &Path) -> bool {
    std::iter::once(&launcher.data_home)
        .chain(&launcher.data_dirs)
        .filter_map(|dir| std::fs::read_dir(dir.join(APPLICATIONS_DIR)).ok())
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path != ours && path.extension().is_some_and(|ext| ext == "desktop"))
        .any(|path| {
            std::fs::read_to_string(&path)
                .is_ok_and(|text| !text.contains(MARKER) && serves(&path, &text, &launcher.app_id))
        })
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if std::fs::read(path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|error| format!("{}: {error}", path.display()))
}

/// Writes or updates the entry and its icon. `wrote_before` says an earlier run wrote the
/// entry, so a missing one was removed on purpose and stays removed.
pub(crate) fn sync(
    launcher: &Launcher,
    icon_png: &[u8],
    wrote_before: bool,
) -> Result<Outcome, String> {
    let path = launcher.entry_path();
    let existing = std::fs::read_to_string(&path).ok();
    let ours = existing
        .as_deref()
        .is_some_and(|text| text.contains(MARKER));
    if (existing.is_some() && !ours) || served_elsewhere(launcher, &path) {
        if ours {
            remove_file(&path)?;
        }
        return Ok(Outcome::Elsewhere);
    }
    if !ours && wrote_before {
        return Ok(Outcome::Removed);
    }
    let edge = png_edge(icon_png).ok_or_else(|| "The app icon is not a square PNG".to_string())?;
    let icon = launcher.icon_path(edge);
    write_if_changed(&icon, icon_png)?;
    let text = entry(&launcher.appimage, &launcher.app_id, &icon);
    if existing.as_deref() == Some(text.as_str()) {
        return Ok(Outcome::Current);
    }
    write_file(&path, &text, false)?;
    Ok(Outcome::Written)
}

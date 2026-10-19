//! Installed apps for the picker, and the apps Oleafly never allows.
//!
//! Blocked apps stay in the list with a reason, so the picker can show why
//! they can't be added.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::Platform;

/// The picker never lists more than this many apps.
pub(crate) const MAX_INSTALLED_APPS: usize = 2000;
/// Desktop entries are small; anything larger is skipped.
const MAX_ENTRY_BYTES: u64 = 64 * 1024;
/// Info.plist files list document types and can be large (office suites).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const MAX_INFO_PLIST_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledApp {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<BlockReason>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BlockReason {
    Oleafly,
    Driver,
    Terminal,
    SystemSettings,
    Passwords,
    Scripting,
    Wrapper,
    Sandboxed,
}

use BlockReason::{
    Driver, Oleafly, Passwords, Sandboxed, Scripting, SystemSettings, Terminal, Wrapper,
};

const BUNDLE_IDS: &[(&str, BlockReason)] = &[
    ("com.oleafly.app", Oleafly),
    ("com.trycua.driver", Driver),
    ("com.apple.Terminal", Terminal),
    ("com.googlecode.iterm2", Terminal),
    ("dev.warp.Warp-Stable", Terminal),
    ("com.mitchellh.ghostty", Terminal),
    ("net.kovidgoyal.kitty", Terminal),
    ("org.alacritty", Terminal),
    ("com.github.wez.wezterm", Terminal),
    ("com.apple.systempreferences", SystemSettings),
    ("com.apple.keychainaccess", Passwords),
    ("com.apple.Passwords", Passwords),
    ("com.apple.ScriptEditor2", Scripting),
    ("com.apple.Automator", Scripting),
    ("com.apple.shortcuts", Scripting),
];

/// Lower-case file names (Windows and Linux).
const FILE_NAMES: &[(&str, BlockReason)] = &[
    ("oleafly", Oleafly),
    ("oleafly.exe", Oleafly),
    ("oleafly-desktop", Oleafly),
    ("cua-driver", Driver),
    ("cua-driver.exe", Driver),
    ("cua", Driver),
    ("cua.exe", Driver),
    ("cmd.exe", Terminal),
    ("powershell.exe", Terminal),
    ("pwsh.exe", Terminal),
    ("wt.exe", Terminal),
    ("windowsterminal.exe", Terminal),
    ("conhost.exe", Terminal),
    ("openconsole.exe", Terminal),
    ("wsl.exe", Terminal),
    ("bash.exe", Terminal),
    ("gnome-terminal", Terminal),
    ("gnome-terminal-server", Terminal),
    ("konsole", Terminal),
    ("xterm", Terminal),
    ("xfce4-terminal", Terminal),
    ("tilix", Terminal),
    ("alacritty", Terminal),
    ("kitty", Terminal),
    ("wezterm", Terminal),
    ("terminator", Terminal),
    ("foot", Terminal),
    ("ptyxis", Terminal),
    ("kgx", Terminal),
    ("sh", Terminal),
    ("bash", Terminal),
    ("zsh", Terminal),
    ("fish", Terminal),
    ("dash", Terminal),
    ("systemsettings.exe", SystemSettings),
    ("control.exe", SystemSettings),
    ("mmc.exe", SystemSettings),
    ("regedit.exe", SystemSettings),
    ("taskmgr.exe", SystemSettings),
    ("gnome-control-center", SystemSettings),
    ("systemsettings", SystemSettings),
    ("seahorse", Passwords),
    ("kwalletmanager5", Passwords),
    ("wscript.exe", Scripting),
    ("cscript.exe", Scripting),
    ("mshta.exe", Scripting),
    ("rundll32.exe", Scripting),
    ("env", Wrapper),
    ("sudo", Wrapper),
    ("pkexec", Wrapper),
    ("su", Wrapper),
    ("perl", Wrapper),
    ("ruby", Wrapper),
    ("node", Wrapper),
    ("java", Wrapper),
    ("javaw", Wrapper),
    ("flatpak", Sandboxed),
    ("snap", Sandboxed),
];

/// The last path component in lower case; both separators count.
pub(crate) fn file_name_lower(path: &str) -> String {
    path.trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_lowercase()
}

fn file_reason(name: &str) -> Option<BlockReason> {
    if name.starts_with("python") {
        return Some(Wrapper);
    }
    FILE_NAMES
        .iter()
        .find(|(blocked, _)| *blocked == name)
        .map(|(_, reason)| *reason)
}

/// Why agents may not use this app, if they may not.
pub(crate) fn blocked_reason(
    platform: Platform,
    bundle_id: Option<&str>,
    executable: Option<&str>,
    own_exe: &str,
) -> Option<BlockReason> {
    if let Some(id) = bundle_id.map(str::trim).filter(|id| !id.is_empty()) {
        if id.to_ascii_lowercase().starts_with("com.oleafly.") {
            return Some(Oleafly);
        }
        if let Some((_, reason)) = BUNDLE_IDS
            .iter()
            .find(|(blocked, _)| blocked.eq_ignore_ascii_case(id))
        {
            return Some(*reason);
        }
    }
    let path = executable.map(str::trim).filter(|path| !path.is_empty())?;
    let name = file_name_lower(path);
    let own = file_name_lower(own_exe);
    if !own.is_empty() && name == own {
        return Some(Oleafly);
    }
    if let Some(reason) = file_reason(&name) {
        return Some(reason);
    }
    if platform == Platform::Windows {
        if [".cmd", ".bat", ".ps1"]
            .iter()
            .any(|extension| name.ends_with(extension))
        {
            return Some(Wrapper);
        }
        if let Some(reason) = name
            .strip_suffix(".exe")
            .or_else(|| name.strip_suffix(".com"))
            .and_then(file_reason)
        {
            return Some(reason);
        }
    }
    None
}

/// The program of a freedesktop `Exec=` value: the first word, with the
/// spec's double-quote rules. Field codes (`%U`) are never a program.
pub(crate) fn exec_program(exec: &str) -> Option<String> {
    let mut program = String::new();
    let mut quoted = false;
    let mut characters = exec.trim_start().chars();
    while let Some(character) = characters.next() {
        match character {
            '"' => quoted = !quoted,
            '\\' if quoted => program.push(characters.next()?),
            ' ' | '\t' if !quoted => break,
            other => program.push(other),
        }
    }
    if quoted || program.is_empty() || program.starts_with('%') {
        return None;
    }
    Some(program)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DesktopEntry {
    pub name: String,
    pub program: String,
}

/// The key-file escapes (`\s`, `\n`, `\t`, `\r`, `\\`).
fn unescape_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }
        match characters.next() {
            Some('s') => out.push(' '),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// A visible application entry: its untranslated name and program.
pub(crate) fn parse_desktop_entry(text: &str) -> Option<DesktopEntry> {
    let mut in_entry = false;
    let mut kind = None;
    let mut name = None;
    let mut exec = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "Type" => kind = Some(value.to_string()),
            "Name" => name = Some(unescape_value(value)),
            "Exec" => exec = Some(unescape_value(value)),
            "NoDisplay" | "Hidden" if value.eq_ignore_ascii_case("true") => return None,
            // Terminal programs run inside a terminal, which is never allowed.
            "Terminal" if value.eq_ignore_ascii_case("true") => return None,
            _ => {}
        }
    }
    if kind.as_deref() != Some("Application") {
        return None;
    }
    let name = name?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let program = exec_program(&exec?)?;
    Some(DesktopEntry { name, program })
}

fn display_name_from_stem(stem: &str) -> String {
    let uniform = stem == stem.to_uppercase() || stem == stem.to_lowercase();
    if !uniform {
        return stem.to_string();
    }
    let lower = stem.to_lowercase();
    let mut characters = lower.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

// Only Windows reads App Paths; the parsing is tested on every OS.
#[cfg_attr(not(windows), allow(dead_code))]
fn looks_like_windows_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    (bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\')
        || path.starts_with(r"\\")
}

/// One `App Paths` entry: the key name (`EXCEL.EXE`) and its default value,
/// expanded and unquoted. Returns `(display name, program path)`.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn app_paths_value(
    key: &str,
    value: &str,
    expand: &dyn Fn(&str) -> String,
) -> Option<(String, String)> {
    let key = key.trim();
    let stem = key
        .len()
        .checked_sub(4)
        .filter(|&cut| key.is_char_boundary(cut) && key[cut..].eq_ignore_ascii_case(".exe"))
        .map(|cut| &key[..cut])?;
    if stem.is_empty() {
        return None;
    }
    let expanded = expand(value.trim());
    let expanded = expanded.trim();
    let path = match expanded.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or_default(),
        None => expanded,
    }
    .trim();
    if !looks_like_windows_absolute(path) || !file_name_lower(path).ends_with(".exe") {
        return None;
    }
    Some((display_name_from_stem(stem), path.to_string()))
}

fn own_exe() -> String {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The canonical, plain form of a program path, the way settings store it.
pub(crate) fn canonical_program(path: &Path) -> Option<String> {
    let canonical = std::fs::canonicalize(path).ok()?;
    canonical.is_file().then(|| {
        oleafly_core::plain_path(&canonical)
            .to_string_lossy()
            .into_owned()
    })
}

/// The app a program file stands for (Windows and Linux), for the picker.
pub(crate) fn app_from_executable(platform: Platform, path: &Path) -> Option<InstalledApp> {
    let executable = canonical_program(path)?;
    let stem = Path::new(&executable)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let own = own_exe();
    let raw = path.to_string_lossy();
    let blocked = blocked_reason(platform, None, Some(&*raw), &own)
        .or_else(|| blocked_reason(platform, None, Some(executable.as_str()), &own));
    Some(InstalledApp {
        name: display_name_from_stem(&stem),
        bundle_id: None,
        executable: Some(executable),
        blocked,
    })
}

/// The app an `.app` bundle stands for (macOS), for the picker.
#[cfg(target_os = "macos")]
pub(crate) fn app_from_bundle(bundle: &Path) -> Option<InstalledApp> {
    let info = bundle.join("Contents").join("Info.plist");
    let size = std::fs::metadata(&info).ok()?.len();
    if size > MAX_INFO_PLIST_BYTES {
        return None;
    }
    let value = plist::Value::from_file(&info).ok()?;
    let dictionary = value.as_dictionary()?;
    let text = |key: &str| {
        dictionary
            .get(key)
            .and_then(plist::Value::as_string)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    let bundle_id = text("CFBundleIdentifier")?;
    let name = text("CFBundleDisplayName")
        .or_else(|| text("CFBundleName"))
        .or_else(|| {
            bundle
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })?;
    let blocked = blocked_reason(Platform::Macos, Some(bundle_id.as_str()), None, &own_exe());
    Some(InstalledApp {
        name,
        bundle_id: Some(bundle_id),
        executable: None,
        blocked,
    })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn app_from_bundle(_bundle: &Path) -> Option<InstalledApp> {
    None
}

/// Apps on this computer, blocked ones included, sorted by name and capped.
pub(crate) fn list_installed_apps(platform: Platform) -> Vec<InstalledApp> {
    let apps = match platform {
        Platform::Macos => macos_apps(),
        Platform::Windows => windows_apps(),
        Platform::Linux => linux_apps(),
    };
    finish(apps)
}

fn finish(mut apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    apps.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    apps.truncate(MAX_INSTALLED_APPS);
    apps
}

#[cfg(target_os = "macos")]
fn macos_apps() -> Vec<InstalledApp> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut apps = Vec::new();
    for root in roots {
        collect_bundles(&root, 1, &mut |bundle| {
            if let Some(app) = app_from_bundle(bundle) {
                let key = app.bundle_id.clone().unwrap_or_default().to_lowercase();
                if seen.insert(key) {
                    apps.push(app);
                }
            }
        });
    }
    apps
}

#[cfg(target_os = "macos")]
fn collect_bundles(dir: &Path, depth: usize, found: &mut dyn FnMut(&Path)) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten().take(4 * MAX_INSTALLED_APPS) {
        let path = entry.path();
        let is_dir = entry
            .file_type()
            .is_ok_and(|kind| kind.is_dir() || kind.is_symlink());
        if !is_dir {
            continue;
        }
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        {
            found(&path);
        } else if depth < 2 {
            collect_bundles(&path, depth + 1, found);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn macos_apps() -> Vec<InstalledApp> {
    Vec::new()
}

#[cfg(windows)]
fn windows_apps() -> Vec<InstalledApp> {
    const APP_PATHS: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths";
    const APP_PATHS_32: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths";
    let expand = |value: &str| {
        crate::program_locator::expand_percent(value, &|name: &str| std::env::var_os(name))
    };
    let own = own_exe();
    let mut seen = std::collections::HashSet::new();
    let mut apps = Vec::new();
    let sources: [(&windows_registry::Key, &str); 3] = [
        (windows_registry::CURRENT_USER, APP_PATHS),
        (windows_registry::LOCAL_MACHINE, APP_PATHS),
        (windows_registry::LOCAL_MACHINE, APP_PATHS_32),
    ];
    for (root, path) in sources {
        let Ok(parent) = root.open(path) else {
            continue;
        };
        let Ok(names) = parent.keys() else {
            continue;
        };
        for name in names.take(4 * MAX_INSTALLED_APPS) {
            let Ok(key) = parent.open(&name) else {
                continue;
            };
            let Ok(values) = key.values() else {
                continue;
            };
            let Some(default) = values
                .take(64)
                .find(|(value_name, _)| value_name.is_empty())
                .and_then(|(_, value)| String::try_from(value).ok())
            else {
                continue;
            };
            let Some((display, program)) = app_paths_value(&name, &default, &expand) else {
                continue;
            };
            let Some(executable) = canonical_program(Path::new(&program)) else {
                continue;
            };
            if !seen.insert(executable.to_lowercase()) {
                continue;
            }
            let blocked = blocked_reason(Platform::Windows, None, Some(executable.as_str()), &own);
            apps.push(InstalledApp {
                name: display,
                bundle_id: None,
                executable: Some(executable),
                blocked,
            });
        }
    }
    apps
}

#[cfg(not(windows))]
fn windows_apps() -> Vec<InstalledApp> {
    Vec::new()
}

/// `$XDG_DATA_HOME/applications`, then each `$XDG_DATA_DIRS/applications`.
pub(crate) fn linux_application_dirs(env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let data_home = env("XDG_DATA_HOME")
        .filter(|value| value.starts_with('/'))
        .map(PathBuf::from)
        .or_else(|| env("HOME").map(|home| Path::new(&home).join(".local/share")));
    if let Some(data_home) = data_home {
        dirs.push(data_home.join("applications"));
    }
    let data_dirs = env("XDG_DATA_DIRS")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
    for dir in data_dirs.split(':').filter(|dir| dir.starts_with('/')) {
        let path = Path::new(dir).join("applications");
        if !dirs.contains(&path) {
            dirs.push(path);
        }
    }
    dirs
}

fn linux_apps() -> Vec<InstalledApp> {
    let env = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    let own = own_exe();
    let search = crate::program_locator::search_dirs();
    let rules = crate::program_locator::MatchRules {
        windows: false,
        native_only: true,
        pathext: None,
    };
    let mut ids = std::collections::HashSet::new();
    let mut programs = std::collections::HashSet::new();
    let mut apps = Vec::new();
    for dir in linux_application_dirs(&env) {
        let mut files = Vec::new();
        collect_desktop_files(&dir, &dir, 1, &mut files);
        for (id, file) in files {
            // An entry earlier in the search order hides later ones with the
            // same id, hidden entries included.
            if !ids.insert(id) {
                continue;
            }
            if !std::fs::metadata(&file).is_ok_and(|meta| meta.len() <= MAX_ENTRY_BYTES) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            let Some(entry) = parse_desktop_entry(&text) else {
                continue;
            };
            let located = if entry.program.starts_with('/') {
                Some(PathBuf::from(&entry.program))
            } else if entry.program.contains('/') {
                None
            } else {
                crate::program_locator::search_in(&search, &entry.program, rules)
                    .0
                    .map(|located| located.path)
            };
            let Some(located) = located else {
                continue;
            };
            let Some(executable) = canonical_program(&located) else {
                continue;
            };
            let raw = located.to_string_lossy();
            let blocked = blocked_reason(Platform::Linux, None, Some(entry.program.as_str()), &own)
                .or_else(|| blocked_reason(Platform::Linux, None, Some(&*raw), &own))
                .or_else(|| blocked_reason(Platform::Linux, None, Some(executable.as_str()), &own));
            if !programs.insert((entry.name.to_lowercase(), executable.clone())) {
                continue;
            }
            apps.push(InstalledApp {
                name: entry.name,
                bundle_id: None,
                executable: Some(executable),
                blocked,
            });
            if apps.len() >= 4 * MAX_INSTALLED_APPS {
                return apps;
            }
        }
    }
    apps
}

fn collect_desktop_files(
    base: &Path,
    dir: &Path,
    depth: usize,
    files: &mut Vec<(String, PathBuf)>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
    entries.sort();
    for path in entries.into_iter().take(8 * MAX_INSTALLED_APPS) {
        if path.is_dir() {
            if depth < 2 {
                collect_desktop_files(base, &path, depth + 1, files);
            }
            continue;
        }
        if path.extension().and_then(|extension| extension.to_str()) != Some("desktop") {
            continue;
        }
        let id = path
            .strip_prefix(base)
            .map(|relative| relative.to_string_lossy().replace('/', "-"))
            .unwrap_or_default();
        if !id.is_empty() {
            files.push((id, path));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_exec_lines_tokenize_per_the_spec() {
        assert_eq!(
            exec_program(r#""/opt/Zotero 7/zotero" %U"#).as_deref(),
            Some("/opt/Zotero 7/zotero")
        );
        assert_eq!(
            exec_program("libreoffice --calc %F").as_deref(),
            Some("libreoffice")
        );
        assert_eq!(
            exec_program("env GDK_BACKEND=x11 /usr/bin/app").as_deref(),
            Some("env")
        );
        assert_eq!(
            exec_program(r#""/opt/a \"b\"/app""#).as_deref(),
            Some(r#"/opt/a "b"/app"#)
        );
        assert_eq!(exec_program("%U"), None);
        assert_eq!(exec_program(r#""/opt/unterminated"#), None);
        assert_eq!(exec_program("   "), None);
    }

    #[test]
    fn desktop_entries_skip_hidden_and_non_applications() {
        let visible = "[Desktop Entry]\nType=Application\nName[de]=Literatur\nName=Zotero\nExec=/opt/zotero/zotero %U\n\n[Desktop Action new]\nName=New window\nExec=/usr/bin/other\n";
        assert_eq!(
            parse_desktop_entry(visible),
            Some(DesktopEntry {
                name: "Zotero".into(),
                program: "/opt/zotero/zotero".into()
            })
        );
        for hidden in [
            "[Desktop Entry]\nType=Application\nName=A\nExec=a\nNoDisplay=true\n",
            "[Desktop Entry]\nType=Application\nName=A\nExec=a\nHidden=true\n",
            "[Desktop Entry]\nType=Link\nName=A\nURL=https://a.org\n",
            "[Desktop Entry]\nType=Application\nName=htop\nExec=htop\nTerminal=true\n",
            "[Desktop Entry]\nName=No type\nExec=a\n",
            "[Desktop Action x]\nType=Application\nName=A\nExec=a\n",
        ] {
            assert_eq!(parse_desktop_entry(hidden), None, "{hidden}");
        }
        let escaped =
            "[Desktop Entry]\nType=Application\nName=My\\sApp\nExec=\"/opt/My App/app\"\n";
        assert_eq!(
            parse_desktop_entry(escaped).unwrap(),
            DesktopEntry {
                name: "My App".into(),
                program: "/opt/My App/app".into()
            }
        );
    }

    #[test]
    fn flatpak_and_env_wrappers_are_blocked_with_a_reason() {
        let own = "/opt/oleafly/oleafly-desktop";
        assert_eq!(
            blocked_reason(Platform::Linux, None, Some("/usr/bin/flatpak"), own),
            Some(BlockReason::Sandboxed)
        );
        assert_eq!(
            blocked_reason(Platform::Linux, None, Some("/usr/bin/env"), own),
            Some(BlockReason::Wrapper)
        );
        assert_eq!(
            blocked_reason(Platform::Linux, None, Some("/usr/bin/python3.12"), own),
            Some(BlockReason::Wrapper)
        );
        assert_eq!(
            blocked_reason(Platform::Linux, None, Some("/usr/bin/gnome-terminal"), own),
            Some(BlockReason::Terminal)
        );
        assert_eq!(
            blocked_reason(
                Platform::Linux,
                None,
                Some("/opt/oleafly/oleafly-desktop"),
                own
            ),
            Some(BlockReason::Oleafly)
        );
        assert_eq!(
            blocked_reason(Platform::Linux, None, Some("/opt/zotero/zotero"), own),
            None
        );
    }

    #[test]
    fn windows_names_match_without_case_and_with_or_without_the_extension() {
        let own = r"C:\Program Files\Oleafly\Oleafly.exe";
        for (path, reason) in [
            (r"C:\Windows\System32\CMD.EXE", BlockReason::Terminal),
            (r"C:\Program Files\nodejs\node.exe", BlockReason::Wrapper),
            (r"C:\Python312\pythonw.exe", BlockReason::Wrapper),
            (r"C:\Tools\build.bat", BlockReason::Wrapper),
            (r"C:\Tools\setup.PS1", BlockReason::Wrapper),
            (r"C:\Windows\System32\mshta.exe", BlockReason::Scripting),
            (
                r"\\?\C:\Users\Zoë\AppData\Local\Programs\Cua\cua-driver\bin\cua-driver.exe",
                BlockReason::Driver,
            ),
            (r"D:\Portable\OLEAFLY.EXE", BlockReason::Oleafly),
        ] {
            assert_eq!(
                blocked_reason(Platform::Windows, None, Some(path), own),
                Some(reason),
                "{path}"
            );
        }
        assert_eq!(
            blocked_reason(
                Platform::Windows,
                None,
                Some(r"C:\Program Files\Stata 18\StataSE-64.exe"),
                own
            ),
            None
        );
    }

    #[test]
    fn macos_bundle_ids_match_without_case() {
        assert_eq!(
            blocked_reason(Platform::Macos, Some("com.apple.terminal"), None, "oleafly"),
            Some(BlockReason::Terminal)
        );
        assert_eq!(
            blocked_reason(
                Platform::Macos,
                Some("com.oleafly.app.e2e"),
                None,
                "oleafly"
            ),
            Some(BlockReason::Oleafly)
        );
        assert_eq!(
            blocked_reason(Platform::Macos, Some("org.zotero.zotero"), None, "oleafly"),
            None
        );
    }

    #[test]
    fn app_paths_values_expand_and_unquote() {
        let expand = |value: &str| value.replace("%ProgramFiles%", r"C:\Program Files");
        assert_eq!(
            app_paths_value(
                "EXCEL.EXE",
                "\"%ProgramFiles%\\Microsoft Office\\root\\Office16\\EXCEL.EXE\"",
                &expand
            ),
            Some((
                "Excel".to_string(),
                r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE".to_string()
            ))
        );
        assert_eq!(
            app_paths_value(
                "StataSE-64.exe",
                r"C:\Program Files\Stata 18\StataSE-64.exe",
                &expand
            ),
            Some((
                "StataSE-64".to_string(),
                r"C:\Program Files\Stata 18\StataSE-64.exe".to_string()
            ))
        );
        assert_eq!(
            app_paths_value("setup.cmd", r"C:\Tools\setup.cmd", &expand),
            None
        );
        assert_eq!(
            app_paths_value("app.exe", "relative\\app.exe", &expand),
            None
        );
        assert_eq!(app_paths_value("app.exe", "", &expand), None);
    }

    #[test]
    fn linux_application_dirs_follow_xdg() {
        let env = |name: &str| match name {
            "HOME" => Some("/home/zoë".to_string()),
            _ => None,
        };
        assert_eq!(
            linux_application_dirs(&env),
            vec![
                PathBuf::from("/home/zoë/.local/share/applications"),
                PathBuf::from("/usr/local/share/applications"),
                PathBuf::from("/usr/share/applications"),
            ]
        );
        let env = |name: &str| match name {
            "XDG_DATA_HOME" => Some("/data".to_string()),
            "XDG_DATA_DIRS" => Some("/var/lib/flatpak/exports/share:/usr/share".to_string()),
            _ => None,
        };
        assert_eq!(
            linux_application_dirs(&env),
            vec![
                PathBuf::from("/data/applications"),
                PathBuf::from("/var/lib/flatpak/exports/share/applications"),
                PathBuf::from("/usr/share/applications"),
            ]
        );
    }

    #[test]
    fn the_list_is_sorted_without_case_and_capped() {
        let apps = (0..2500)
            .rev()
            .map(|index| InstalledApp {
                name: if index % 2 == 0 {
                    format!("app {index:04}")
                } else {
                    format!("App {index:04}")
                },
                bundle_id: None,
                executable: Some(format!("/opt/app{index}")),
                blocked: None,
            })
            .collect();
        let apps = finish(apps);
        assert_eq!(apps.len(), MAX_INSTALLED_APPS);
        assert_eq!(apps[0].name, "app 0000");
        assert_eq!(apps[1].name, "App 0001");
    }

    #[test]
    fn installed_apps_serialize_for_the_picker() {
        let app = InstalledApp {
            name: "Terminal".into(),
            bundle_id: Some("com.apple.Terminal".into()),
            executable: None,
            blocked: Some(BlockReason::SystemSettings),
        };
        let json = serde_json::to_value(&app).unwrap();
        assert_eq!(json["bundleId"], "com.apple.Terminal");
        assert_eq!(json["blocked"], "system_settings");
        assert!(json.get("executable").is_none());
    }
}

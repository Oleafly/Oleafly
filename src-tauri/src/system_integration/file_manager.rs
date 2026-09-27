use super::{Item, ItemId, ItemState};
use crate::open_request::OPEN_FOLDER_FLAG;
use std::path::{Path, PathBuf};

pub(crate) const DOLPHIN_DIR: &str = "kio/servicemenus";
pub(crate) const DOLPHIN_FILE: &str = "oleafly-open-folder.desktop";
pub(crate) const NEMO_DIR: &str = "nemo/actions";
pub(crate) const NEMO_FILE: &str = "oleafly-open-folder.nemo_action";
pub(crate) const NAUTILUS_DIR: &str = "nautilus/scripts";
pub(crate) const APPLICATIONS_DIR: &str = "applications";
const ICON: &str = "oleafly";
const LABEL_KEY: &str = "systemIntegration.openWithOleafly";
pub(crate) const MOVED: &str = "moved";
pub(crate) const NO_DEFAULT_FILE_MANAGER: &str = "no_default_file_manager";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Programs {
    pub(crate) dolphin: bool,
    pub(crate) nemo: bool,
    pub(crate) nautilus: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Layout {
    pub(crate) exe: String,
    pub(crate) identifier: String,
    pub(crate) data_home: PathBuf,
    pub(crate) system_share: PathBuf,
    pub(crate) programs: Programs,
    pub(crate) folder_handler_set: bool,
    pub(crate) nautilus_script: Option<String>,
}

pub(crate) fn desktop_locale(locale: &str) -> String {
    match locale {
        "zh-Hans" => "zh_CN".to_string(),
        "zh-Hant" => "zh_TW".to_string(),
        other => other.replace('-', "_"),
    }
}

fn desktop_value(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
        .replace('\r', "\\r")
}

pub(crate) fn exec_argument(argument: &str) -> String {
    let argument = argument.replace('%', "%%");
    let reserved = argument.chars().any(|next| {
        next.is_whitespace()
            || matches!(
                next,
                '"' | '\''
                    | '\\'
                    | '>'
                    | '<'
                    | '~'
                    | '|'
                    | '&'
                    | ';'
                    | '$'
                    | '*'
                    | '?'
                    | '#'
                    | '('
                    | ')'
                    | '`'
            )
    });
    if !reserved {
        return argument;
    }
    let mut quoted = String::from('"');
    for next in argument.chars() {
        if matches!(next, '"' | '`' | '$' | '\\') {
            quoted.push('\\');
        }
        quoted.push(next);
    }
    quoted.push('"');
    quoted
}

fn exec_line(exe: &str, field: &str) -> String {
    desktop_value(&format!(
        "{} {OPEN_FOLDER_FLAG} {field}",
        exec_argument(exe)
    ))
}

fn names(key: &str) -> String {
    let mut lines = format!("Name={}\n", desktop_value(&crate::i18n::t_in("en", key)));
    for locale in crate::i18n::SUPPORTED
        .iter()
        .filter(|locale| **locale != "en")
    {
        lines.push_str(&format!(
            "Name[{}]={}\n",
            desktop_locale(locale),
            desktop_value(&crate::i18n::t_in(locale, key))
        ));
    }
    lines
}

pub(crate) fn dolphin_service_menu(exe: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Service\nMimeType=inode/directory;\nActions=openWithOleafly;\nX-KDE-Priority=TopLevel\n\n[Desktop Action openWithOleafly]\n{}Icon={ICON}\nExec={}\n",
        names(LABEL_KEY),
        exec_line(exe, "%f"),
    )
}

pub(crate) fn nemo_action(exe: &str) -> String {
    format!(
        "[Nemo Action]\nActive=true\n{}Exec={}\nIcon-Name={ICON}\nSelection=s\nExtensions=dir;\nQuote=double\n",
        names(LABEL_KEY),
        exec_line(exe, "%F"),
    )
}

fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

pub(crate) fn nautilus_script(exe: &str) -> String {
    format!(
        "#!/bin/sh\nnewline='\n'\nfolder=${{NAUTILUS_SCRIPT_SELECTED_FILE_PATHS%%\"$newline\"*}}\n[ -n \"$folder\" ] || folder=$PWD\nexec {} {OPEN_FOLDER_FLAG} \"$folder\"\n",
        shell_quote(exe)
    )
}

pub(crate) fn script_name(label: &str) -> String {
    let name: String = label
        .chars()
        .map(|next| {
            if next == '/' || next == '\0' {
                ' '
            } else {
                next
            }
        })
        .collect();
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        "Oleafly".to_string()
    } else {
        name.to_string()
    }
}

pub(crate) fn open_with_entry(exe: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=Oleafly\nExec={}\nIcon={ICON}\nNoDisplay=true\nMimeType=inode/directory;\nTerminal=false\n",
        exec_line(exe, "%f"),
    )
}

fn open_with_path(layout: &Layout) -> PathBuf {
    layout
        .data_home
        .join(APPLICATIONS_DIR)
        .join(format!("{}.open-folder.desktop", layout.identifier))
}

fn file_state(path: &Path, expected: &str) -> ItemState {
    match std::fs::read_to_string(path) {
        Ok(text) if text == expected => ItemState::Installed,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ItemState::NotInstalled,
        _ => ItemState::NeedsAttention,
    }
}

fn user_item(id: ItemId, state: ItemState, attention: &'static str) -> Item {
    Item {
        id,
        state,
        packaged: false,
        attention: (state == ItemState::NeedsAttention).then_some(attention),
    }
}

fn shipped_action(
    layout: &Layout,
    id: ItemId,
    detected: bool,
    dir: &str,
    file: &str,
    expected: &str,
) -> Option<Item> {
    if layout.system_share.join(dir).join(file).is_file() {
        return detected.then_some(Item {
            id,
            state: ItemState::Installed,
            packaged: true,
            attention: None,
        });
    }
    let state = file_state(&layout.data_home.join(dir).join(file), expected);
    (detected || state != ItemState::NotInstalled).then(|| user_item(id, state, MOVED))
}

pub(crate) fn item(layout: &Layout, id: ItemId) -> Option<Item> {
    match id {
        ItemId::Dolphin => shipped_action(
            layout,
            id,
            layout.programs.dolphin,
            DOLPHIN_DIR,
            DOLPHIN_FILE,
            &dolphin_service_menu(&layout.exe),
        ),
        ItemId::Nemo => shipped_action(
            layout,
            id,
            layout.programs.nemo,
            NEMO_DIR,
            NEMO_FILE,
            &nemo_action(&layout.exe),
        ),
        ItemId::Nautilus => {
            let state = layout
                .nautilus_script
                .as_deref()
                .map_or(ItemState::NotInstalled, |name| {
                    file_state(
                        &layout.data_home.join(NAUTILUS_DIR).join(name),
                        &nautilus_script(&layout.exe),
                    )
                });
            (layout.programs.nautilus || state != ItemState::NotInstalled)
                .then(|| user_item(id, state, MOVED))
        }
        ItemId::FolderOpenWith => {
            let state = file_state(&open_with_path(layout), &open_with_entry(&layout.exe));
            if !layout.folder_handler_set && state != ItemState::NotInstalled {
                return Some(user_item(
                    id,
                    ItemState::NeedsAttention,
                    NO_DEFAULT_FILE_MANAGER,
                ));
            }
            layout
                .folder_handler_set
                .then(|| user_item(id, state, MOVED))
        }
        ItemId::QuickAction | ItemId::ExplorerMenu => None,
    }
}

pub(crate) fn status(layout: &Layout) -> Vec<Item> {
    [
        ItemId::Dolphin,
        ItemId::Nemo,
        ItemId::Nautilus,
        ItemId::FolderOpenWith,
    ]
    .into_iter()
    .filter_map(|id| item(layout, id))
    .collect()
}

fn write_file(path: &Path, text: &str, executable: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, text).map_err(|error| format!("{}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if executable { 0o755 } else { 0o644 };
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
            .map_err(|error| format!("{}: {error}", path.display()))?;
    }
    #[cfg(not(unix))]
    let _ = executable;
    Ok(())
}

fn remove_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn place(path: &Path, text: &str, executable: bool, enabled: bool) -> Result<(), String> {
    if enabled {
        write_file(path, text, executable)
    } else {
        remove_file(path)
    }
}

pub(crate) fn set(
    layout: &Layout,
    id: ItemId,
    enabled: bool,
    label: &str,
) -> Result<Option<String>, String> {
    match id {
        ItemId::Dolphin | ItemId::Nemo => {
            let (dir, file, text, executable) = if id == ItemId::Dolphin {
                (
                    DOLPHIN_DIR,
                    DOLPHIN_FILE,
                    dolphin_service_menu(&layout.exe),
                    true,
                )
            } else {
                (NEMO_DIR, NEMO_FILE, nemo_action(&layout.exe), false)
            };
            if layout.system_share.join(dir).join(file).is_file() {
                return Err(format!("{id:?} comes with the installed package"));
            }
            place(
                &layout.data_home.join(dir).join(file),
                &text,
                executable,
                enabled,
            )?;
            Ok(None)
        }
        ItemId::Nautilus => {
            let dir = layout.data_home.join(NAUTILUS_DIR);
            if let Some(previous) = &layout.nautilus_script {
                remove_file(&dir.join(previous))?;
            }
            if !enabled {
                return Ok(None);
            }
            let name = script_name(label);
            write_file(&dir.join(&name), &nautilus_script(&layout.exe), true)?;
            Ok(Some(name))
        }
        ItemId::FolderOpenWith => {
            if enabled && !layout.folder_handler_set {
                return Err("No default file manager is set for folders".to_string());
            }
            let path = open_with_path(layout);
            place(&path, &open_with_entry(&layout.exe), false, enabled)?;
            #[cfg(target_os = "linux")]
            refresh_desktop_database(path.parent());
            Ok(None)
        }
        ItemId::QuickAction | ItemId::ExplorerMenu => {
            Err(format!("{id:?} is not available on Linux"))
        }
    }
}

#[cfg(target_os = "linux")]
fn refresh_desktop_database(dir: Option<&Path>) {
    let Some(dir) = dir else {
        return;
    };
    let mut command = std::process::Command::new("update-desktop-database");
    command.arg(dir);
    let _ = crate::proc::output_contained_with_timeout(command, std::time::Duration::from_secs(5));
}

#[cfg(target_os = "linux")]
impl Programs {
    pub(crate) fn detect() -> Self {
        let dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect())
            .unwrap_or_default();
        let found = |name: &str| dirs.iter().any(|dir| dir.join(name).is_file());
        Self {
            dolphin: found("dolphin"),
            nemo: found("nemo"),
            nautilus: found("nautilus"),
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn folder_handler_is_set() -> bool {
    let mut command = std::process::Command::new("xdg-mime");
    command.args(["query", "default", "inode/directory"]);
    crate::proc::output_contained_with_timeout(command, std::time::Duration::from_secs(3))
        .is_ok_and(|output| {
            output.status.success() && !String::from_utf8_lossy(&output.stdout).trim().is_empty()
        })
}

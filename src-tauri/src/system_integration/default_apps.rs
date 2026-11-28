use super::ItemId;

pub(crate) const ITEMS: [ItemId; 4] = [
    ItemId::DefaultLatex,
    ItemId::DefaultTypst,
    ItemId::DefaultMarkdown,
    ItemId::DefaultQuarto,
];

#[cfg(any(target_os = "macos", test))]
pub(crate) fn extensions(item: ItemId) -> &'static [&'static str] {
    match item {
        ItemId::DefaultLatex => &["tex"],
        ItemId::DefaultTypst => &["typ"],
        ItemId::DefaultMarkdown => &["md", "markdown"],
        ItemId::DefaultQuarto => &["qmd", "Rmd"],
        _ => &[],
    }
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn mime_types(item: ItemId) -> &'static [&'static [&'static str]] {
    match item {
        ItemId::DefaultLatex => &[&["text/x-tex", "application/x-tex"]],
        ItemId::DefaultTypst => &[&["text/vnd.typst", "text/x-typst"]],
        ItemId::DefaultMarkdown => &[&["text/markdown", "text/x-markdown"]],
        ItemId::DefaultQuarto => &[&["text/x-quarto"], &["text/x-r-markdown"]],
        _ => &[],
    }
}

#[cfg(any(target_os = "linux", test))]
const DEFAULTS_SECTION: &str = "[Default Applications]";

#[cfg(any(target_os = "linux", test))]
fn defaults_section(lines: &[String]) -> Option<(usize, usize)> {
    let start = lines
        .iter()
        .position(|line| line.trim() == DEFAULTS_SECTION)?;
    let end = lines[start + 1..]
        .iter()
        .position(|line| line.trim_start().starts_with('['))
        .map_or(lines.len(), |offset| start + 1 + offset);
    Some((start, end))
}

#[cfg(any(target_os = "linux", test))]
fn entry(line: &str) -> Option<(&str, Vec<&str>)> {
    let (key, value) = line.split_once('=')?;
    let ids = value
        .split(';')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .collect();
    Some((key.trim(), ids))
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn linux_is_default(mimeapps: &str, item: ItemId, desktop_id: &str) -> bool {
    let lines: Vec<String> = mimeapps.lines().map(str::to_string).collect();
    let Some((start, end)) = defaults_section(&lines) else {
        return false;
    };
    let first_choice = |names: &[&str]| {
        lines[start + 1..end].iter().find_map(|line| {
            entry(line)
                .filter(|(key, _)| names.contains(key))
                .and_then(|(_, ids)| ids.first().map(|id| *id == desktop_id))
        })
    };
    let groups = mime_types(item);
    !groups.is_empty() && groups.iter().all(|names| first_choice(names) == Some(true))
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn linux_with_default(
    mimeapps: &str,
    item: ItemId,
    desktop_id: &str,
    on: bool,
) -> Option<String> {
    let mut lines: Vec<String> = mimeapps.lines().map(str::to_string).collect();
    let section = defaults_section(&lines);
    if section.is_none() && !on {
        return None;
    }
    let (start, mut end) = section.unwrap_or_else(|| {
        if lines.last().is_some_and(|line| !line.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push(DEFAULTS_SECTION.to_string());
        (lines.len() - 1, lines.len())
    });
    for names in mime_types(item) {
        let mut others: Vec<String> = Vec::new();
        let mut found = None;
        let mut index = start + 1;
        while index < end {
            let parsed = entry(&lines[index])
                .filter(|(key, _)| names.contains(key))
                .map(|(_, ids)| ids.into_iter().map(str::to_string).collect::<Vec<_>>());
            let Some(ids) = parsed else {
                index += 1;
                continue;
            };
            for id in ids {
                if id != desktop_id && !others.contains(&id) {
                    others.push(id);
                }
            }
            lines.remove(index);
            end -= 1;
            found.get_or_insert(index);
        }
        let ids: Vec<String> = if on {
            std::iter::once(desktop_id.to_string())
                .chain(others)
                .collect()
        } else {
            others
        };
        if ids.is_empty() {
            continue;
        }
        let at = found.unwrap_or_else(|| {
            (start + 1..end)
                .rev()
                .find(|&index| !lines[index].trim().is_empty())
                .map_or(start + 1, |index| index + 1)
        });
        lines.insert(at, format!("{}={};", names[0], ids.join(";")));
        end += 1;
    }
    let updated = lines.join("\n") + "\n";
    let unchanged = updated == mimeapps || updated.trim_end() == mimeapps.trim_end();
    (!unchanged).then_some(updated)
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn without_silent_markdown_claim(mimeapps: &str, desktop_id: &str) -> Option<String> {
    let lines: Vec<String> = mimeapps.lines().map(str::to_string).collect();
    let (start, end) = defaults_section(&lines)?;
    let ours = format!("{desktop_id};");
    let index = (start + 1..end).find(|&index| {
        lines[index]
            .split_once('=')
            .is_some_and(|(key, value)| key.trim() == "text/markdown" && value.trim() == ours)
    })?;
    let mut lines = lines;
    lines.remove(index);
    Some(lines.join("\n") + "\n")
}

#[cfg(target_os = "linux")]
fn mimeapps_path(config_home: &std::path::Path) -> std::path::PathBuf {
    let listed = config_home.join("mimeapps.list");
    listed.canonicalize().unwrap_or(listed)
}

#[cfg(target_os = "linux")]
fn read_mimeapps(path: &std::path::Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

#[cfg(target_os = "linux")]
fn rewrite_mimeapps(
    config_home: &std::path::Path,
    change: impl FnOnce(&str) -> Option<String>,
) -> Result<(), String> {
    let path = mimeapps_path(config_home);
    let text = read_mimeapps(&path)?;
    let Some(updated) = change(&text) else {
        return Ok(());
    };
    std::fs::create_dir_all(config_home).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&path, updated.as_bytes())
}

#[cfg(target_os = "linux")]
pub(crate) fn linux_state(
    config_home: &std::path::Path,
    item: ItemId,
    desktop_id: &str,
) -> Result<bool, String> {
    let text = read_mimeapps(&mimeapps_path(config_home))?;
    Ok(linux_is_default(&text, item, desktop_id))
}

#[cfg(target_os = "linux")]
pub(crate) fn linux_set(
    config_home: &std::path::Path,
    item: ItemId,
    desktop_id: &str,
    on: bool,
) -> Result<(), String> {
    rewrite_mimeapps(config_home, |text| {
        linux_with_default(text, item, desktop_id, on)
    })
}

#[cfg(target_os = "linux")]
pub(crate) fn linux_undo_silent_markdown_claim(
    config_home: &std::path::Path,
    desktop_id: &str,
) -> Result<(), String> {
    rewrite_mimeapps(config_home, |text| {
        without_silent_markdown_claim(text, desktop_id)
    })
}

#[cfg(target_os = "macos")]
const ALL_ROLES: u32 = 0xFFFF_FFFF;

#[cfg(target_os = "macos")]
#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn UTTypeCreatePreferredIdentifierForTag(
        tag_class: *const objc2_foundation::NSString,
        tag: *const objc2_foundation::NSString,
        conforming_to: *const objc2_foundation::NSString,
    ) -> *mut objc2_foundation::NSString;
    fn LSSetDefaultRoleHandlerForContentType(
        content_type: *const objc2_foundation::NSString,
        role: u32,
        handler: *const objc2_foundation::NSString,
    ) -> i32;
    fn LSCopyDefaultRoleHandlerForContentType(
        content_type: *const objc2_foundation::NSString,
        role: u32,
    ) -> *mut objc2_foundation::NSString;
}

#[cfg(target_os = "macos")]
fn content_type(extension: &str) -> Option<objc2::rc::Retained<objc2_foundation::NSString>> {
    use objc2_foundation::NSString;
    let tag_class = NSString::from_str("public.filename-extension");
    let tag = NSString::from_str(extension);
    // SAFETY: both strings outlive the call, and the returned string follows the
    // CoreFoundation create rule, so taking ownership of it here balances its retain.
    unsafe {
        objc2::rc::Retained::from_raw(UTTypeCreatePreferredIdentifierForTag(
            &*tag_class,
            &*tag,
            std::ptr::null(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn declared_types(item: ItemId) -> Option<Vec<objc2::rc::Retained<objc2_foundation::NSString>>> {
    let mut types: Vec<objc2::rc::Retained<objc2_foundation::NSString>> = Vec::new();
    for extension in extensions(item) {
        let found = content_type(extension)?;
        if found.to_string().starts_with("dyn.") {
            return None;
        }
        if !types
            .iter()
            .any(|known| known.to_string() == found.to_string())
        {
            types.push(found);
        }
    }
    Some(types)
}

#[cfg(target_os = "macos")]
pub(crate) enum MacState {
    Default,
    Other,
    NoFileType,
}

#[cfg(target_os = "macos")]
pub(crate) fn mac_state(item: ItemId, bundle_id: &str) -> MacState {
    let Some(types) = declared_types(item) else {
        return MacState::NoFileType;
    };
    let ours = types.iter().all(|content_type| {
        // SAFETY: the string outlives the call; the result follows the create rule,
        // so owning it here balances its retain.
        let handler = unsafe {
            objc2::rc::Retained::from_raw(LSCopyDefaultRoleHandlerForContentType(
                &**content_type,
                ALL_ROLES,
            ))
        };
        handler.is_some_and(|handler| handler.to_string().eq_ignore_ascii_case(bundle_id))
    });
    if ours {
        MacState::Default
    } else {
        MacState::Other
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn mac_make_default(item: ItemId, bundle_id: &str) -> Result<(), String> {
    let types = declared_types(item)
        .ok_or_else(|| format!("no file type is declared for {:?} on this Mac", item))?;
    let handler = objc2_foundation::NSString::from_str(bundle_id);
    let failures: Vec<String> = types
        .iter()
        .filter_map(|content_type| {
            // SAFETY: both strings outlive the call, which only reads them.
            let status = unsafe {
                LSSetDefaultRoleHandlerForContentType(&**content_type, ALL_ROLES, &*handler)
            };
            (status != 0).then(|| format!("{content_type}: error {status}"))
        })
        .collect();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join(", "))
    }
}

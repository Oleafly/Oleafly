#[cfg(any(target_os = "macos", test))]
pub(crate) const EXTENSIONS: &[&str] = &["tex", "typ", "md", "markdown"];

#[cfg(any(target_os = "linux", test))]
pub(crate) const MIME_TYPES: &[(&str, &str)] = &[
    ("text/x-tex", "application/x-tex"),
    ("text/vnd.typst", "text/x-typst"),
    ("text/markdown", "text/x-markdown"),
];

#[cfg(any(target_os = "linux", test))]
const DEFAULTS_SECTION: &str = "[Default Applications]";

#[cfg(any(target_os = "linux", test))]
pub(crate) fn with_defaults(mimeapps: &str, desktop_id: &str) -> Option<String> {
    let mut lines: Vec<String> = mimeapps.lines().map(str::to_string).collect();
    let section = lines
        .iter()
        .position(|line| line.trim() == DEFAULTS_SECTION)
        .map(|start| {
            let end = lines[start + 1..]
                .iter()
                .position(|line| line.trim_start().starts_with('['))
                .map_or(lines.len(), |offset| start + 1 + offset);
            (start, end)
        });
    let chosen = |mime: &str| {
        section.is_some_and(|(start, end)| {
            lines[start + 1..end].iter().any(|line| {
                line.split_once('=')
                    .is_some_and(|(key, _)| key.trim() == mime)
            })
        })
    };
    let missing: Vec<String> = MIME_TYPES
        .iter()
        .filter(|(mime, alias)| !chosen(mime) && !chosen(alias))
        .map(|(mime, _)| format!("{mime}={desktop_id};"))
        .collect();
    if missing.is_empty() {
        return None;
    }
    match section {
        Some((start, end)) => {
            let at = (start + 1..end)
                .rev()
                .find(|&index| !lines[index].trim().is_empty())
                .map_or(start + 1, |index| index + 1);
            lines.splice(at..at, missing);
        }
        None => {
            if lines.last().is_some_and(|line| !line.trim().is_empty()) {
                lines.push(String::new());
            }
            lines.push(DEFAULTS_SECTION.to_string());
            lines.extend(missing);
        }
    }
    Some(lines.join("\n") + "\n")
}

#[cfg(target_os = "linux")]
pub(crate) fn claim(config_home: &std::path::Path, desktop_id: &str) -> Result<(), String> {
    let listed = config_home.join("mimeapps.list");
    let path = listed.canonicalize().unwrap_or(listed);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("{}: {error}", path.display())),
    };
    let Some(updated) = with_defaults(&text, desktop_id) else {
        return Ok(());
    };
    std::fs::create_dir_all(config_home).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&path, updated.as_bytes())
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
pub(crate) fn claim(bundle_id: &str) -> Result<(), String> {
    let handler = objc2_foundation::NSString::from_str(bundle_id);
    let mut claimed: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for extension in EXTENSIONS {
        let Some(content_type) = content_type(extension) else {
            failures.push(format!(".{extension} has no file type"));
            continue;
        };
        let name = content_type.to_string();
        if claimed.contains(&name) {
            continue;
        }
        // SAFETY: both strings outlive the call, which only reads them.
        let status =
            unsafe { LSSetDefaultRoleHandlerForContentType(&*content_type, ALL_ROLES, &*handler) };
        if status == 0 {
            claimed.push(name);
        } else {
            failures.push(format!(".{extension} ({name}): error {status}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join(", "))
    }
}

use super::ItemState;
use std::path::Path;

pub(crate) const WORKFLOW_DIR: &str = "Open in Oleafly.workflow";
const INFO_PLIST: &str = "Info.plist";
const DOCUMENT: &str = "document.wflow";

pub(crate) fn valid_bundle_id(bundle_id: &str) -> bool {
    !bundle_id.is_empty()
        && bundle_id
            .chars()
            .all(|next| next.is_ascii_alphanumeric() || next == '.' || next == '-')
}

pub(crate) fn shell_command(bundle_id: &str) -> String {
    format!("/usr/bin/open -b '{bundle_id}' \"$@\"")
}

fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for next in text.chars() {
        match next {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            other => escaped.push(other),
        }
    }
    escaped
}

const PLIST_HEAD: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n";

pub(crate) fn info_plist(menu_title: &str, bundle_id: &str) -> String {
    let title = escape(menu_title);
    let id = escape(bundle_id);
    format!(
        "{PLIST_HEAD}<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>en</string>
\t<key>CFBundleIdentifier</key>
\t<string>{id}.open-folder-quick-action</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>{title}</string>
\t<key>CFBundlePackageType</key>
\t<string>BNDL</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0</string>
\t<key>CFBundleVersion</key>
\t<string>1</string>
\t<key>NSServices</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSMenuItem</key>
\t\t\t<dict>
\t\t\t\t<key>default</key>
\t\t\t\t<string>{title}</string>
\t\t\t</dict>
\t\t\t<key>NSMessage</key>
\t\t\t<string>runWorkflowAsService</string>
\t\t\t<key>NSRequiredContext</key>
\t\t\t<dict>
\t\t\t\t<key>NSApplicationIdentifier</key>
\t\t\t\t<string>com.apple.finder</string>
\t\t\t</dict>
\t\t\t<key>NSSendFileTypes</key>
\t\t\t<array>
\t\t\t\t<string>public.folder</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
"
    )
}

pub(crate) fn document(bundle_id: &str) -> String {
    let command = escape(&shell_command(bundle_id));
    format!(
        "{PLIST_HEAD}<dict>
\t<key>AMApplicationBuild</key>
\t<string>521</string>
\t<key>AMApplicationVersion</key>
\t<string>2.10</string>
\t<key>AMDocumentVersion</key>
\t<string>2</string>
\t<key>actions</key>
\t<array>
\t\t<dict>
\t\t\t<key>action</key>
\t\t\t<dict>
\t\t\t\t<key>AMAccepts</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Optional</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.path</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>AMActionVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>AMApplication</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>AMParameterProperties</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<dict/>
\t\t\t\t</dict>
\t\t\t\t<key>AMProvides</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>ActionBundlePath</key>
\t\t\t\t<string>/System/Library/Automator/Run Shell Script.action</string>
\t\t\t\t<key>ActionName</key>
\t\t\t\t<string>Run Shell Script</string>
\t\t\t\t<key>ActionParameters</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<string>{command}</string>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<integer>1</integer>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<string>/bin/sh</string>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<string></string>
\t\t\t\t</dict>
\t\t\t\t<key>BundleIdentifier</key>
\t\t\t\t<string>com.apple.RunShellScript</string>
\t\t\t\t<key>CFBundleVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>CanShowSelectedItemsWhenRun</key>
\t\t\t\t<false/>
\t\t\t\t<key>CanShowWhenRun</key>
\t\t\t\t<true/>
\t\t\t\t<key>Category</key>
\t\t\t\t<array>
\t\t\t\t\t<string>AMCategoryUtilities</string>
\t\t\t\t</array>
\t\t\t\t<key>Class Name</key>
\t\t\t\t<string>RunShellScriptAction</string>
\t\t\t\t<key>InputUUID</key>
\t\t\t\t<string>6A8E6C1B-3F51-4C4B-9E0D-0C7A1D2E3F40</string>
\t\t\t\t<key>Keywords</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Shell</string>
\t\t\t\t\t<string>Script</string>
\t\t\t\t</array>
\t\t\t\t<key>OutputUUID</key>
\t\t\t\t<string>6A8E6C1B-3F51-4C4B-9E0D-0C7A1D2E3F41</string>
\t\t\t\t<key>UUID</key>
\t\t\t\t<string>6A8E6C1B-3F51-4C4B-9E0D-0C7A1D2E3F42</string>
\t\t\t\t<key>UnlocalizedApplications</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t</dict>
\t\t\t<key>isViewVisible</key>
\t\t\t<true/>
\t\t</dict>
\t</array>
\t<key>connectors</key>
\t<dict/>
\t<key>workflowMetaData</key>
\t<dict>
\t\t<key>serviceApplicationBundleID</key>
\t\t<string>com.apple.finder</string>
\t\t<key>serviceApplicationPath</key>
\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t<key>serviceInputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject.folder</string>
\t\t<key>serviceOutputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>serviceProcessesInput</key>
\t\t<false/>
\t\t<key>workflowTypeIdentifier</key>
\t\t<string>com.apple.Automator.servicesMenu</string>
\t</dict>
</dict>
</plist>
"
    )
}

pub(crate) fn install(services: &Path, menu_title: &str, bundle_id: &str) -> Result<(), String> {
    if !valid_bundle_id(bundle_id) {
        return Err(format!("{bundle_id:?} is not a bundle identifier"));
    }
    std::fs::create_dir_all(services).map_err(|error| error.to_string())?;
    let staging = services.join(format!(".{WORKFLOW_DIR}.{}", std::process::id()));
    let written = write_workflow(&staging, menu_title, bundle_id).and_then(|()| {
        let target = services.join(WORKFLOW_DIR);
        if std::fs::symlink_metadata(&target).is_ok() {
            remove_entry(&target)?;
        }
        std::fs::rename(&staging, &target).map_err(|error| error.to_string())
    });
    if written.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    written
}

fn write_workflow(root: &Path, menu_title: &str, bundle_id: &str) -> Result<(), String> {
    if std::fs::symlink_metadata(root).is_ok() {
        remove_entry(root)?;
    }
    let contents = root.join("Contents");
    std::fs::create_dir_all(&contents).map_err(|error| error.to_string())?;
    std::fs::write(contents.join(INFO_PLIST), info_plist(menu_title, bundle_id))
        .map_err(|error| error.to_string())?;
    std::fs::write(contents.join(DOCUMENT), document(bundle_id))
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    for path in [
        root.to_path_buf(),
        contents.clone(),
        contents.join(INFO_PLIST),
        contents.join(DOCUMENT),
    ] {
        strip_quarantine(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    }
    Ok(())
}

fn remove_entry(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
    .map_err(|error| error.to_string())
}

pub(crate) fn remove(services: &Path) -> Result<(), String> {
    let target = services.join(WORKFLOW_DIR);
    match std::fs::symlink_metadata(&target) {
        Ok(_) => remove_entry(&target),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn state(services: &Path, bundle_id: &str) -> ItemState {
    let root = services.join(WORKFLOW_DIR);
    let Ok(metadata) = std::fs::symlink_metadata(&root) else {
        return ItemState::NotInstalled;
    };
    let contents = root.join("Contents");
    let current = metadata.is_dir()
        && contents.join(INFO_PLIST).is_file()
        && std::fs::read_to_string(contents.join(DOCUMENT)).ok() == Some(document(bundle_id));
    #[cfg(target_os = "macos")]
    let current = current
        && [
            root.clone(),
            contents.join(INFO_PLIST),
            contents.join(DOCUMENT),
        ]
        .iter()
        .all(|path| !is_quarantined(path));
    if current {
        ItemState::Installed
    } else {
        ItemState::NeedsAttention
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn services_dir() -> Result<std::path::PathBuf, String> {
    Ok(crate::paths::home_dir()?.join("Library").join("Services"))
}

#[cfg(target_os = "macos")]
pub(crate) fn refresh_services() {
    let child = std::process::Command::new("/System/Library/CoreServices/pbs")
        .arg("-update")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    if let Ok(mut child) = child {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

#[cfg(target_os = "macos")]
const QUARANTINE: &std::ffi::CStr = c"com.apple.quarantine";

#[cfg(target_os = "macos")]
fn c_path(path: &Path) -> std::io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))
}

#[cfg(target_os = "macos")]
pub(crate) fn is_quarantined(path: &Path) -> bool {
    let Ok(path) = c_path(path) else {
        return false;
    };
    let size = unsafe {
        libc::getxattr(
            path.as_ptr(),
            QUARANTINE.as_ptr(),
            std::ptr::null_mut(),
            0,
            0,
            libc::XATTR_NOFOLLOW,
        )
    };
    size >= 0
}

#[cfg(target_os = "macos")]
pub(crate) fn strip_quarantine(path: &Path) -> std::io::Result<()> {
    let path = c_path(path)?;
    let removed =
        unsafe { libc::removexattr(path.as_ptr(), QUARANTINE.as_ptr(), libc::XATTR_NOFOLLOW) };
    if removed == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ENOATTR) {
        Ok(())
    } else {
        Err(error)
    }
}

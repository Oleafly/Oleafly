use oleafly_core::{Error, ErrorKind};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const OPEN_FOLDER_FLAG: &str = "--open-folder";
const APP_OVERRIDE: &str = "OLEAFLY_APP";
const DOWNLOAD_URL: &str = "https://oleafly.com";
#[cfg(any(target_os = "macos", test))]
const BUNDLE_ID: &str = "com.oleafly.app";
#[cfg(any(not(any(target_os = "macos", windows)), test))]
const LINUX_APP: &str = "oleafly-desktop";
#[cfg(any(windows, test))]
const WINDOWS_APP: &str = "oleafly.exe";
#[cfg(windows)]
const REGISTRY_KEY: &str = r"Software\Oleafly\Oleafly";
#[cfg(any(not(any(target_os = "macos", windows)), test))]
const BUNDLE_VARIABLES: [&str; 4] = ["APPIMAGE", "APPDIR", "ARGV0", "OWD"];
const APP_NOT_FOUND: [&str; 2] = [
    "Unable to find application",
    "LSCopyApplicationURLsForBundleIdentifier",
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Launch {
    Services(Vec<OsString>),
    Detached {
        program: PathBuf,
        arguments: Vec<OsString>,
    },
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Hive {
    CurrentUser,
    LocalMachine,
}

pub(crate) fn resolve_folder(requested: &Path, current: &Path) -> Result<PathBuf, Error> {
    let joined = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        current.join(requested)
    };
    let canonical = joined.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Error::new(
                ErrorKind::InvalidInput,
                format!("There's no folder at {}", requested.display()),
            )
        } else {
            Error::new(
                ErrorKind::Io,
                format!("Couldn't open {}: {error}", requested.display()),
            )
        }
    })?;
    if !canonical.is_dir() {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!(
                "{} is a file. Pass the folder it's in instead",
                requested.display()
            ),
        ));
    }
    Ok(plain_path(canonical))
}

#[cfg(windows)]
fn plain_path(path: PathBuf) -> PathBuf {
    without_verbatim_prefix(&path)
}

#[cfg(not(windows))]
fn plain_path(path: PathBuf) -> PathBuf {
    path
}

#[cfg(any(windows, test))]
fn without_verbatim_prefix(path: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path.to_path_buf();
    };
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest)
            if rest.len() >= 2
                && rest.as_bytes()[0].is_ascii_alphabetic()
                && rest.as_bytes()[1] == b':' =>
        {
            PathBuf::from(rest)
        }
        _ => path.to_path_buf(),
    }
}

pub(crate) fn open_in_app(folder: &Path) -> Result<(), Error> {
    let own = own_executable();
    let launch = match app_override() {
        Some(app) => override_launch(
            &override_target(&app, own.as_deref())?,
            folder,
            cfg!(target_os = "macos"),
        ),
        None => installed_app_launch(folder, own.as_deref())?,
    };
    run(launch)
}

fn override_target(app: &Path, own: Option<&Path>) -> Result<PathBuf, Error> {
    if !app.exists() {
        return Err(missing_override(app));
    }
    if is_this_command(app, own) {
        return Err(override_is_this_command(app));
    }
    Ok(app.to_path_buf())
}

fn is_this_command(candidate: &Path, own: Option<&Path>) -> bool {
    own.is_some_and(|own| {
        candidate
            .canonicalize()
            .is_ok_and(|resolved| resolved == own)
    })
}

#[cfg(any(not(target_os = "macos"), test))]
fn launchable(candidate: &Path, own: Option<&Path>) -> bool {
    candidate.is_file() && !is_this_command(candidate, own)
}

fn app_override() -> Option<PathBuf> {
    std::env::var_os(APP_OVERRIDE)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn override_launch(app: &Path, folder: &Path, launch_services: bool) -> Launch {
    if launch_services && app.extension().is_some_and(|extension| extension == "app") {
        services(OsString::from("-a"), app.as_os_str().to_owned(), folder)
    } else {
        detached(app, folder)
    }
}

fn detached(program: &Path, folder: &Path) -> Launch {
    Launch::Detached {
        program: program.to_path_buf(),
        arguments: vec![
            OsString::from(OPEN_FOLDER_FLAG),
            folder.as_os_str().to_owned(),
        ],
    }
}

#[cfg(target_os = "macos")]
fn installed_app_launch(folder: &Path, own: Option<&Path>) -> Result<Launch, Error> {
    let own_bundle = own.and_then(enclosing_app_bundle);
    Ok(macos_launch(folder, own_bundle.as_deref()))
}

#[cfg(windows)]
fn installed_app_launch(folder: &Path, own: Option<&Path>) -> Result<Launch, Error> {
    let candidates = windows_candidates(
        own.and_then(Path::parent).map(Path::to_path_buf),
        registry_value,
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        std::env::var_os("ProgramFiles").map(PathBuf::from),
    );
    first_installed(candidates, |candidate| launchable(candidate, own))
        .map(|app| detached(&app, folder))
        .ok_or_else(not_installed)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn installed_app_launch(folder: &Path, own: Option<&Path>) -> Result<Launch, Error> {
    let candidates = linux_candidates(
        own_appimage(
            std::env::var_os("APPIMAGE").map(PathBuf::from),
            std::env::var_os("APPDIR").map(PathBuf::from),
        ),
        own.and_then(Path::parent).map(Path::to_path_buf),
        crate::desktop_link::recorded_app(),
        std::env::var_os("PATH"),
    );
    first_installed(candidates, |candidate| launchable(candidate, own))
        .map(|app| detached(&app, folder))
        .ok_or_else(not_installed)
}

#[cfg(any(not(any(target_os = "macos", windows)), test))]
fn own_appimage(appimage: Option<PathBuf>, appdir: Option<PathBuf>) -> Option<PathBuf> {
    let appimage = appimage.filter(|path| path.is_absolute())?;
    let appdir = appdir.filter(|path| path.is_absolute())?;
    appdir
        .join("usr/bin")
        .join(LINUX_APP)
        .is_file()
        .then_some(appimage)
}

#[cfg(any(not(any(target_os = "macos", windows)), test))]
fn scrub_bundle_environment(command: &mut std::process::Command) {
    for variable in BUNDLE_VARIABLES {
        command.env_remove(variable);
    }
}

fn own_executable() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|executable| executable.canonicalize().ok())
}

#[cfg(any(target_os = "macos", test))]
fn macos_launch(folder: &Path, own_bundle: Option<&Path>) -> Launch {
    match own_bundle {
        Some(bundle) => services(OsString::from("-a"), bundle.as_os_str().to_owned(), folder),
        None => services(OsString::from("-b"), OsString::from(BUNDLE_ID), folder),
    }
}

fn services(selector: OsString, app: OsString, folder: &Path) -> Launch {
    Launch::Services(vec![
        selector,
        app,
        folder.as_os_str().to_owned(),
        OsString::from("--args"),
        OsString::from(OPEN_FOLDER_FLAG),
        folder.as_os_str().to_owned(),
    ])
}

#[cfg(any(target_os = "macos", test))]
fn enclosing_app_bundle(executable: &Path) -> Option<PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let shaped = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    shaped.then(|| bundle.to_path_buf())
}

#[cfg(any(not(any(target_os = "macos", windows)), test))]
fn linux_candidates(
    appimage: Option<PathBuf>,
    own_directory: Option<PathBuf>,
    recorded: Option<PathBuf>,
    search_path: Option<OsString>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.extend(appimage);
    candidates.extend(own_directory.map(|directory| directory.join(LINUX_APP)));
    candidates.extend(recorded);
    candidates.push(Path::new("/usr/bin").join(LINUX_APP));
    candidates.extend(
        search_path
            .iter()
            .flat_map(std::env::split_paths)
            .filter(|directory| directory.is_absolute())
            .map(|directory| directory.join(LINUX_APP)),
    );
    unique(candidates)
}

#[cfg(any(windows, test))]
fn windows_candidates(
    own_directory: Option<PathBuf>,
    registry: impl Fn(Hive, Option<&str>) -> Option<OsString>,
    local_app_data: Option<PathBuf>,
    program_files: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut directories: Vec<PathBuf> = own_directory.into_iter().collect();
    for hive in [Hive::CurrentUser, Hive::LocalMachine] {
        for value in [None, Some("InstallDir")] {
            directories.extend(
                registry(hive, value)
                    .and_then(|directory| unquoted(&directory))
                    .map(PathBuf::from),
            );
        }
    }
    directories.extend(local_app_data.map(|directory| directory.join("Oleafly")));
    directories.extend(program_files.map(|directory| directory.join("Oleafly")));
    unique(
        directories
            .into_iter()
            .map(|directory| directory.join(WINDOWS_APP))
            .collect(),
    )
}

#[cfg(any(windows, test))]
fn unquoted(value: &std::ffi::OsStr) -> Option<OsString> {
    let text = value.to_str()?.trim();
    let text = text
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(text);
    (!text.is_empty()).then(|| OsString::from(text))
}

#[cfg(any(not(target_os = "macos"), test))]
fn unique(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        if !seen.contains(&candidate) {
            seen.push(candidate);
        }
    }
    seen
}

#[cfg(any(not(target_os = "macos"), test))]
fn first_installed(candidates: Vec<PathBuf>, installed: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|candidate| installed(candidate))
}

#[cfg(windows)]
fn registry_value(hive: Hive, value: Option<&str>) -> Option<OsString> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };
    let root = match hive {
        Hive::CurrentUser => HKEY_CURRENT_USER,
        Hive::LocalMachine => HKEY_LOCAL_MACHINE,
    };
    let wide = |text: &str| -> Vec<u16> {
        std::ffi::OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let key = wide(REGISTRY_KEY);
    let name = value.map(wide);
    let name_pointer = name.as_ref().map_or(std::ptr::null(), |name| name.as_ptr());
    let mut size: u32 = 0;
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            name_pointer,
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS || size < 2 {
        return None;
    }
    let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            name_pointer,
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    Some(OsString::from_wide(&buffer[..length]))
}

fn run(launch: Launch) -> Result<(), Error> {
    match launch {
        Launch::Services(arguments) => {
            let output = std::process::Command::new("/usr/bin/open")
                .args(&arguments)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .output()
                .map_err(|error| {
                    Error::new(
                        ErrorKind::Io,
                        format!("Couldn't run /usr/bin/open: {error}"),
                    )
                })?;
            if output.status.success() {
                Ok(())
            } else {
                Err(launch_services_error(&String::from_utf8_lossy(
                    &output.stderr,
                )))
            }
        }
        Launch::Detached { program, arguments } => {
            let mut command = std::process::Command::new(&program);
            command
                .args(&arguments)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            #[cfg(not(any(target_os = "macos", windows)))]
            scrub_bundle_environment(&mut command);
            crate::process::detach(&mut command);
            command.spawn().map(drop).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    not_installed()
                } else {
                    Error::new(
                        ErrorKind::Io,
                        format!("Couldn't start Oleafly at {}: {error}", program.display()),
                    )
                }
            })
        }
    }
}

fn launch_services_error(stderr: &str) -> Error {
    if APP_NOT_FOUND.iter().any(|marker| stderr.contains(marker)) {
        return not_installed();
    }
    Error::new(
        ErrorKind::Io,
        format!("macOS couldn't open Oleafly: {}", stderr.trim()),
    )
}

fn not_installed() -> Error {
    Error::new(
        ErrorKind::MissingTool,
        format!("Oleafly isn't installed. Download it from {DOWNLOAD_URL}, then try again"),
    )
}

fn missing_override(app: &Path) -> Error {
    Error::new(
        ErrorKind::MissingTool,
        format!(
            "{APP_OVERRIDE} is set to {}, but nothing is there",
            app.display()
        ),
    )
}

fn override_is_this_command(app: &Path) -> Error {
    Error::new(
        ErrorKind::MissingTool,
        format!(
            "{APP_OVERRIDE} is set to {}, but that's this command. Point it at the Oleafly app instead",
            app.display()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn arguments(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn relative_and_absolute_folders_resolve_to_one_canonical_path() {
        let root = TempDir::new().unwrap();
        let thesis = root.path().join("my thesis").join("論文 café");
        std::fs::create_dir_all(thesis.join("chapters")).unwrap();
        let canonical = thesis.canonicalize().unwrap();
        let chapters = thesis.join("chapters");

        assert_eq!(resolve_folder(Path::new("."), &thesis).unwrap(), canonical);
        assert_eq!(
            resolve_folder(Path::new(".."), &chapters).unwrap(),
            canonical
        );
        assert_eq!(
            resolve_folder(Path::new("論文 café"), &root.path().join("my thesis")).unwrap(),
            canonical
        );
        assert_eq!(
            resolve_folder(Path::new("./chapters/.."), &thesis).unwrap(),
            canonical
        );
        assert_eq!(
            resolve_folder(&thesis, Path::new("/elsewhere")).unwrap(),
            canonical
        );
    }

    #[test]
    fn a_folder_named_like_a_command_resolves_like_any_other() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir(root.path().join("build")).unwrap();
        assert_eq!(
            resolve_folder(Path::new("build"), root.path()).unwrap(),
            root.path().join("build").canonicalize().unwrap()
        );
    }

    #[test]
    fn missing_folders_and_files_are_refused_with_the_path_the_user_typed() {
        let root = TempDir::new().unwrap();
        std::fs::write(root.path().join("paper.tex"), "x").unwrap();

        let missing = resolve_folder(Path::new("nowhere"), root.path()).unwrap_err();
        assert_eq!(missing.kind(), ErrorKind::InvalidInput);
        assert!(
            missing.message().contains("nowhere"),
            "{}",
            missing.message()
        );

        let file = resolve_folder(Path::new("paper.tex"), root.path()).unwrap_err();
        assert_eq!(file.kind(), ErrorKind::InvalidInput);
        assert!(file.message().contains("paper.tex"), "{}", file.message());
    }

    #[test]
    fn windows_verbatim_prefixes_are_removed_before_the_app_sees_the_path() {
        for (input, expected) in [
            (r"\\?\C:\Users\me\thesis", r"C:\Users\me\thesis"),
            (r"\\?\UNC\server\share\thesis", r"\\server\share\thesis"),
            (r"C:\Users\me\thesis", r"C:\Users\me\thesis"),
            (r"\\?\Volume{0000}\thesis", r"\\?\Volume{0000}\thesis"),
        ] {
            assert_eq!(
                without_verbatim_prefix(Path::new(input)),
                PathBuf::from(expected)
            );
        }
    }

    #[test]
    fn macos_asks_launch_services_for_the_app_that_owns_the_command() {
        let folder = Path::new("/Users/me/my thesis");
        assert_eq!(
            macos_launch(folder, None),
            Launch::Services(arguments(&[
                "-b",
                "com.oleafly.app",
                "/Users/me/my thesis",
                "--args",
                "--open-folder",
                "/Users/me/my thesis"
            ]))
        );
        assert_eq!(
            macos_launch(folder, Some(Path::new("/Applications/Oleafly.app"))),
            Launch::Services(arguments(&[
                "-a",
                "/Applications/Oleafly.app",
                "/Users/me/my thesis",
                "--args",
                "--open-folder",
                "/Users/me/my thesis"
            ]))
        );
    }

    #[test]
    fn the_bundled_command_knows_which_app_it_came_from() {
        assert_eq!(
            enclosing_app_bundle(Path::new(
                "/Applications/Oleafly.app/Contents/MacOS/oleafly-cli"
            )),
            Some(PathBuf::from("/Applications/Oleafly.app"))
        );
        assert_eq!(
            enclosing_app_bundle(Path::new("/usr/local/bin/oleafly")),
            None
        );
        assert_eq!(
            enclosing_app_bundle(Path::new("/tmp/Contents/MacOS/oleafly-cli")),
            None
        );
    }

    #[test]
    fn an_explicit_app_is_opened_by_bundle_or_run_directly() {
        let folder = Path::new("/work/thesis");
        assert_eq!(
            override_launch(Path::new("/Users/me/dev/Oleafly.app"), folder, true),
            Launch::Services(arguments(&[
                "-a",
                "/Users/me/dev/Oleafly.app",
                "/work/thesis",
                "--args",
                "--open-folder",
                "/work/thesis"
            ]))
        );
        assert_eq!(
            override_launch(Path::new("/opt/oleafly/oleafly-desktop"), folder, true),
            Launch::Detached {
                program: PathBuf::from("/opt/oleafly/oleafly-desktop"),
                arguments: arguments(&["--open-folder", "/work/thesis"]),
            }
        );
        assert_eq!(
            override_launch(Path::new("/opt/Oleafly.app"), folder, false),
            Launch::Detached {
                program: PathBuf::from("/opt/Oleafly.app"),
                arguments: arguments(&["--open-folder", "/work/thesis"]),
            }
        );
    }

    #[test]
    fn linux_prefers_the_appimage_then_the_app_beside_the_command() {
        let candidates = linux_candidates(
            Some(PathBuf::from("/home/me/Apps/Oleafly.AppImage")),
            Some(PathBuf::from("/usr/bin")),
            Some(PathBuf::from(
                "/home/me/Downloads/Oleafly_0.5.0_amd64.AppImage",
            )),
            Some(OsString::from(
                "/home/me/.local/bin:relative/bin:/opt/tools",
            )),
        );
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/home/me/Apps/Oleafly.AppImage"),
                PathBuf::from("/usr/bin/oleafly-desktop"),
                PathBuf::from("/home/me/Downloads/Oleafly_0.5.0_amd64.AppImage"),
                PathBuf::from("/home/me/.local/bin/oleafly-desktop"),
                PathBuf::from("/opt/tools/oleafly-desktop"),
            ]
        );
        assert_eq!(
            linux_candidates(None, None, None, None),
            vec![PathBuf::from("/usr/bin/oleafly-desktop")]
        );
    }

    #[test]
    fn linux_never_launches_the_command_line_tool_as_the_app() {
        let candidates = linux_candidates(None, Some(PathBuf::from("/usr/bin")), None, None);
        assert!(candidates
            .iter()
            .all(|candidate| candidate.file_name().is_some_and(|name| name != "oleafly")));
    }

    #[test]
    fn windows_reads_the_install_folder_per_user_before_per_machine() {
        let registry = |hive: Hive, value: Option<&str>| {
            let found = match (hive, value) {
                (Hive::CurrentUser, None) => r"C:\Users\me\AppData\Local\Programs\Oleafly",
                (Hive::CurrentUser, Some("InstallDir")) => r#""E:\Oleafly\""#,
                (Hive::LocalMachine, None) => r"D:\Apps\Oleafly",
                _ => return None,
            };
            Some(OsString::from(found))
        };
        let candidates = windows_candidates(
            Some(PathBuf::from(r"C:\tools")),
            registry,
            Some(PathBuf::from(r"C:\Users\me\AppData\Local")),
            Some(PathBuf::from(r"C:\Program Files")),
        );
        let expected = vec![
            Path::new(r"C:\tools").join("oleafly.exe"),
            Path::new(r"C:\Users\me\AppData\Local\Programs\Oleafly").join("oleafly.exe"),
            Path::new(r"E:\Oleafly\").join("oleafly.exe"),
            Path::new(r"D:\Apps\Oleafly").join("oleafly.exe"),
            Path::new(r"C:\Users\me\AppData\Local")
                .join("Oleafly")
                .join("oleafly.exe"),
            Path::new(r"C:\Program Files")
                .join("Oleafly")
                .join("oleafly.exe"),
        ];
        assert_eq!(candidates, expected);
        assert!(windows_candidates(None, |_, _| None, None, None).is_empty());
    }

    #[test]
    fn windows_never_launches_the_command_itself() {
        let root = TempDir::new().unwrap();
        let tools = root.path().join("tools");
        let installed = root.path().join("Programs").join("Oleafly");
        std::fs::create_dir_all(&tools).unwrap();
        std::fs::create_dir_all(&installed).unwrap();
        std::fs::write(tools.join(WINDOWS_APP), b"standalone command").unwrap();
        std::fs::write(installed.join(WINDOWS_APP), b"desktop app").unwrap();
        let own = tools.join(WINDOWS_APP).canonicalize().unwrap();
        let registry = |hive: Hive, value: Option<&str>| {
            (hive == Hive::CurrentUser && value.is_none())
                .then(|| installed.clone().into_os_string())
        };
        let candidates = windows_candidates(Some(tools.clone()), registry, None, None);
        assert_eq!(candidates[0], tools.join(WINDOWS_APP));
        assert_eq!(
            first_installed(candidates.clone(), |candidate| launchable(
                candidate,
                Some(&own)
            )),
            Some(installed.join(WINDOWS_APP))
        );
        assert_eq!(
            first_installed(candidates, |candidate| launchable(candidate, None)),
            Some(tools.join(WINDOWS_APP))
        );

        std::fs::write(tools.join("oleafly-cli.exe"), b"bundled command").unwrap();
        let bundled = tools.join("oleafly-cli.exe").canonicalize().unwrap();
        assert_eq!(
            first_installed(vec![tools.join(WINDOWS_APP)], |candidate| launchable(
                candidate,
                Some(&bundled)
            )),
            Some(tools.join(WINDOWS_APP))
        );
        assert!(!launchable(&tools.join("missing.exe"), Some(&bundled)));
        assert!(!launchable(&tools, Some(&bundled)));
    }

    #[test]
    fn an_explicit_app_that_is_this_command_is_refused() {
        let root = TempDir::new().unwrap();
        let command = root.path().join("oleafly");
        std::fs::write(&command, b"command").unwrap();
        let own = command.canonicalize().unwrap();
        let error = override_target(&command, Some(&own)).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::MissingTool);
        assert!(
            error.message().contains(APP_OVERRIDE),
            "{}",
            error.message()
        );
        assert_eq!(override_target(&command, None).unwrap(), command);
        let missing = override_target(&root.path().join("nowhere"), Some(&own)).unwrap_err();
        assert!(
            missing.message().contains("nothing is there"),
            "{}",
            missing.message()
        );
    }

    #[test]
    fn an_inherited_appimage_counts_only_when_it_is_oleafly() {
        let root = TempDir::new().unwrap();
        let appimage = root.path().join("Oleafly.AppImage");
        std::fs::write(&appimage, b"appimage").unwrap();
        let ours = root.path().join(".mount_Oleafl1");
        std::fs::create_dir_all(ours.join("usr/bin")).unwrap();
        std::fs::write(ours.join("usr/bin").join(LINUX_APP), b"app").unwrap();
        let foreign = root.path().join(".mount_Editor2");
        std::fs::create_dir_all(foreign.join("usr/bin")).unwrap();
        std::fs::write(foreign.join("usr/bin/editor"), b"editor").unwrap();

        assert_eq!(
            own_appimage(Some(appimage.clone()), Some(ours.clone())),
            Some(appimage.clone())
        );
        assert_eq!(
            own_appimage(Some(appimage.clone()), Some(foreign.clone())),
            None
        );
        assert_eq!(own_appimage(Some(appimage.clone()), None), None);
        assert_eq!(own_appimage(None, Some(ours.clone())), None);
        assert_eq!(
            own_appimage(Some(PathBuf::from("Oleafly.AppImage")), Some(ours)),
            None
        );
    }

    #[test]
    fn the_app_never_inherits_another_appimage_environment() {
        let mut command = std::process::Command::new("/usr/bin/oleafly-desktop");
        scrub_bundle_environment(&mut command);
        let removed: Vec<_> = command
            .get_envs()
            .filter(|(_, value)| value.is_none())
            .map(|(name, _)| name.to_string_lossy().into_owned())
            .collect();
        for variable in ["APPIMAGE", "APPDIR", "ARGV0", "OWD"] {
            assert!(
                removed.iter().any(|name| name == variable),
                "{variable} is inherited"
            );
        }
    }

    #[test]
    fn linux_and_windows_hand_the_folder_over_as_one_argument() {
        assert_eq!(
            detached(
                Path::new(r"C:\Users\me\AppData\Local\Oleafly\oleafly.exe"),
                Path::new(r"C:\Users\me\My Thesis")
            ),
            Launch::Detached {
                program: PathBuf::from(r"C:\Users\me\AppData\Local\Oleafly\oleafly.exe"),
                arguments: arguments(&["--open-folder", r"C:\Users\me\My Thesis"]),
            }
        );
    }

    #[test]
    fn the_first_installed_candidate_wins() {
        let candidates = vec![
            PathBuf::from("/missing/oleafly-desktop"),
            PathBuf::from("/usr/bin/oleafly-desktop"),
            PathBuf::from("/opt/oleafly-desktop"),
        ];
        let installed = |path: &Path| path.starts_with("/usr") || path.starts_with("/opt");
        assert_eq!(
            first_installed(candidates.clone(), installed),
            Some(PathBuf::from("/usr/bin/oleafly-desktop"))
        );
        assert_eq!(first_installed(candidates, |_| false), None);
    }

    #[test]
    fn launch_failures_say_what_to_do_next() {
        for stderr in [
            "Unable to find application with bundle identifier com.oleafly.app\n",
            "LSCopyApplicationURLsForBundleIdentifier() failed while trying to determine the application with bundle identifier com.oleafly.app.\n",
        ] {
            let missing = launch_services_error(stderr);
            assert_eq!(missing.kind(), ErrorKind::MissingTool, "{stderr}");
            assert!(
                missing.message().contains("https://oleafly.com"),
                "{}",
                missing.message()
            );
        }

        let other = launch_services_error("LSOpenURLsWithRole() failed with error -10810\n");
        assert_eq!(other.kind(), ErrorKind::Io);
        assert!(other.message().contains("-10810"), "{}", other.message());

        let missing = launch_services_error("");
        assert_eq!(missing.kind(), ErrorKind::Io);
        assert_eq!(not_installed().kind(), ErrorKind::MissingTool);
        let pointed = missing_override(Path::new("/nowhere/Oleafly.app"));
        assert_eq!(pointed.kind(), ErrorKind::MissingTool);
        assert!(
            pointed.message().contains("OLEAFLY_APP"),
            "{}",
            pointed.message()
        );
    }

    #[test]
    fn the_linux_app_binary_matches_the_bundle_configuration() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let linux: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(root.join("src-tauri/tauri.linux.conf.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(linux["mainBinaryName"], LINUX_APP);
        for package in ["deb", "rpm"] {
            assert_eq!(
                linux["bundle"]["linux"][package]["files"]["/usr/bin/oleafly"], "./linux/oleafly",
                "{package} packages keep /usr/bin/oleafly working after the rename"
            );
        }
        let base: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(root.join("src-tauri/tauri.conf.json")).unwrap(),
        )
        .unwrap();
        assert!(
            base.get("mainBinaryName").is_none(),
            "macOS and Windows keep the binary name Cargo gives them"
        );
        assert_eq!(base["identifier"], BUNDLE_ID);
        assert_eq!(base["productName"], "Oleafly");
        assert_eq!(base["bundle"]["publisher"], "Oleafly");
    }

    #[cfg(unix)]
    #[test]
    fn the_packaged_oleafly_opens_the_app_bare_and_runs_the_command_otherwise() {
        use std::os::unix::fs::PermissionsExt;
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let shim = root.join("src-tauri/linux/oleafly");
        let mode = std::fs::metadata(&shim).unwrap().permissions().mode();
        assert_eq!(
            mode & 0o111,
            0o111,
            "the packaged command must be executable"
        );
        let staged = TempDir::new().unwrap();
        let bin = staged.path().join("usr-bin");
        std::fs::create_dir(&bin).unwrap();
        let record = staged.path().join("record.txt");
        for (name, label) in [(LINUX_APP, "app"), ("oleafly-cli", "command")] {
            let program = bin.join(name);
            std::fs::write(
                &program,
                format!(
                    "#!/bin/sh\nprintf '%s\\n' {label} \"$@\" > '{}'\n",
                    record.display()
                ),
            )
            .unwrap();
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let text = std::fs::read_to_string(&shim)
            .unwrap()
            .replace("/usr/bin/", &format!("{}/", bin.display()));
        let staged_shim = bin.join("oleafly");
        std::fs::write(&staged_shim, text).unwrap();
        std::fs::set_permissions(&staged_shim, std::fs::Permissions::from_mode(0o755)).unwrap();

        let run = |arguments: &[&str]| -> Vec<String> {
            let _ = std::fs::remove_file(&record);
            let status = std::process::Command::new(&staged_shim)
                .args(arguments)
                .status()
                .unwrap();
            assert!(status.success(), "{arguments:?}");
            std::fs::read_to_string(&record)
                .unwrap()
                .lines()
                .map(str::to_string)
                .collect()
        };
        assert_eq!(run(&[]), vec!["app"]);
        assert_eq!(run(&["."]), vec!["command", "."]);
        assert_eq!(
            run(&["--json", "open", "my thesis/論文"]),
            vec!["command", "--json", "open", "my thesis/論文"]
        );
        assert_eq!(run(&[""]), vec!["command", ""]);
    }

    #[test]
    fn no_script_or_workflow_still_launches_the_app_as_usr_bin_oleafly() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut stale = Vec::new();
        let mut pending = vec![
            root.join(".github"),
            root.join("scripts"),
            root.join("e2e"),
            root.join("src-tauri/tauri.conf.json"),
            root.join("src-tauri/tauri.linux.conf.json"),
            root.join("src-tauri/tauri.e2e.conf.json"),
        ];
        while let Some(path) = pending.pop() {
            if path.is_dir() {
                for entry in std::fs::read_dir(&path).unwrap() {
                    let entry = entry.unwrap().path();
                    if entry.file_name().is_some_and(|name| name != "node_modules") {
                        pending.push(entry);
                    }
                }
                continue;
            }
            let fixture = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(".test."));
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            if fixture {
                continue;
            }
            for (index, _) in text.match_indices("/usr/bin/oleafly") {
                let rest = &text[index + "/usr/bin/oleafly".len()..];
                let packaged = rest.starts_with("\":");
                let next = rest.chars().next();
                if !packaged && !next.is_some_and(|next| next == '-' || next.is_alphanumeric()) {
                    stale.push(path.display().to_string());
                }
            }
        }
        assert!(stale.is_empty(), "stale GUI paths in {stale:?}");
    }
}

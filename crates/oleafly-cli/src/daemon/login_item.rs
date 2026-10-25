//! Starting the background helper when the user signs in: a launch agent
//! on macOS (`~/Library/LaunchAgents`), a `Run` value on Windows
//! (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), an autostart
//! entry on Linux (`$XDG_CONFIG_HOME/autostart`). Each starts the app's own
//! executable (or the AppImage) with `--oleafly-daemon --at-login`; the
//! helper exits at once when there is nothing to do.
//!
//! The entry takes effect at the next sign-in; enabling it starts nothing
//! now.
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::app_paths::Platform;

pub const LAUNCH_AGENT_LABEL: &str = "com.oleafly.app.background";
pub const RUN_VALUE_NAME: &str = "OleaflyBackground";
pub const AUTOSTART_FILE: &str = "com.oleafly.app.background.desktop";
pub const DAEMON_ARGS: [&str; 2] = ["--oleafly-daemon", "--at-login"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum LoginItemState {
    Enabled,
    Disabled,
    /// macOS runs the app from a temporary copy until it is moved to
    /// Applications; an entry made now would point at nothing later.
    MoveApp,
    Unsupported {
        reason: String,
    },
}

/// What the entry starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoginExec {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// The `Run` key, behind a trait so tests use a map.
pub trait RunRegistry: Send + Sync {
    fn get(&self, name: &str) -> Option<String>;
    fn set(&self, name: &str, value: &str) -> io::Result<()>;
    fn delete(&self, name: &str) -> io::Result<()>;
}

pub struct LoginEnv {
    pub platform: Platform,
    pub home: PathBuf,
    pub xdg_config_home: Option<PathBuf>,
    /// Windows only.
    pub registry: Option<Box<dyn RunRegistry>>,
}

impl LoginEnv {
    /// This computer's.
    pub fn current() -> Option<Self> {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .or_else(|| std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
            .map(PathBuf::from)?;
        Some(Self {
            platform: Platform::current(),
            home,
            xdg_config_home: std::env::var_os("XDG_CONFIG_HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .filter(|path| path.is_absolute()),
            registry: windows_registry(),
        })
    }
}

#[cfg(windows)]
fn windows_registry() -> Option<Box<dyn RunRegistry>> {
    Some(Box::new(windows::HkcuRun::new(windows::RUN_KEY)))
}

#[cfg(not(windows))]
fn windows_registry() -> Option<Box<dyn RunRegistry>> {
    None
}

/// The program to start: the AppImage when the app runs from one.
pub fn login_exec(exe: &Path, appimage: Option<&Path>) -> LoginExec {
    LoginExec {
        program: appimage.unwrap_or(exe).to_path_buf(),
        args: DAEMON_ARGS.iter().map(|arg| (*arg).to_string()).collect(),
    }
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// `~/Library/LaunchAgents/com.oleafly.app.background.plist`.
pub fn launch_agent_plist(exec: &LoginExec) -> String {
    let mut arguments = format!(
        "    <string>{}</string>\n",
        xml_escape(&exec.program.to_string_lossy())
    );
    for arg in &exec.args {
        arguments.push_str(&format!("    <string>{}</string>\n", xml_escape(arg)));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n\
<dict>\n\
  <key>Label</key>\n\
  <string>{LAUNCH_AGENT_LABEL}</string>\n\
  <key>ProgramArguments</key>\n\
  <array>\n\
{arguments}  </array>\n\
  <key>RunAtLoad</key>\n\
  <true/>\n\
  <key>ProcessType</key>\n\
  <string>Background</string>\n\
  <key>LimitLoadToSessionType</key>\n\
  <string>Aqua</string>\n\
</dict>\n\
</plist>\n"
    )
}

/// The `Run` value: the executable quoted, then the flags.
pub fn run_value(exec: &LoginExec) -> String {
    let mut value = format!("\"{}\"", exec.program.to_string_lossy());
    for arg in &exec.args {
        value.push(' ');
        value.push_str(arg);
    }
    value
}

/// A Desktop Entry string value (`\\`, `\n`, `\t`, `\r`).
fn desktop_string(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\t' => escaped.push_str("\\t"),
            '\r' => escaped.push_str("\\r"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// One `Exec` argument, quoted by the Desktop Entry rules: `"`, `` ` ``,
/// `$` and `\` get a backslash, `%` doubles, and the string escape is
/// applied over that (so a literal `$` is written `\\$`).
fn exec_argument(text: &str) -> String {
    let mut quoted = String::from("\"");
    for character in text.chars() {
        match character {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(character);
            }
            '%' => quoted.push_str("%%"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    desktop_string(&quoted)
}

/// `$XDG_CONFIG_HOME/autostart/com.oleafly.app.background.desktop`.
pub fn autostart_entry(exec: &LoginExec) -> String {
    let program = exec.program.to_string_lossy();
    let mut command = exec_argument(&program);
    for arg in &exec.args {
        command.push(' ');
        command.push_str(arg);
    }
    format!(
        "[Desktop Entry]\n\
Type=Application\n\
Name=Oleafly background helper\n\
Comment=Keeps Oleafly research tasks running after the app closes\n\
Exec={command}\n\
TryExec={}\n\
NoDisplay=true\n\
Terminal=false\n\
X-GNOME-Autostart-enabled=true\n",
        desktop_string(&program)
    )
}

fn plist_path(env: &LoginEnv) -> PathBuf {
    env.home
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{LAUNCH_AGENT_LABEL}.plist"))
}

fn autostart_path(env: &LoginEnv) -> PathBuf {
    env.xdg_config_home
        .clone()
        .unwrap_or_else(|| env.home.join(".config"))
        .join("autostart")
        .join(AUTOSTART_FILE)
}

fn translocated(exec: &LoginExec) -> bool {
    exec.program
        .to_string_lossy()
        .contains("/AppTranslocation/")
}

fn file_matches(path: &Path, expected: &str) -> bool {
    std::fs::read_to_string(path).is_ok_and(|content| content == expected)
}

fn no_registry() -> LoginItemState {
    LoginItemState::Unsupported {
        reason: "The Windows registry can't be reached.".into(),
    }
}

/// `Enabled` only when our entry exists and starts `exec`.
pub fn status(env: &LoginEnv, exec: &LoginExec) -> LoginItemState {
    let enabled = match env.platform {
        Platform::MacOs => {
            if translocated(exec) {
                return LoginItemState::MoveApp;
            }
            file_matches(&plist_path(env), &launch_agent_plist(exec))
        }
        Platform::Windows => match &env.registry {
            Some(registry) => {
                registry.get(RUN_VALUE_NAME).as_deref() == Some(run_value(exec).as_str())
            }
            None => return no_registry(),
        },
        Platform::Linux => file_matches(&autostart_path(env), &autostart_entry(exec)),
    };
    if enabled {
        LoginItemState::Enabled
    } else {
        LoginItemState::Disabled
    }
}

fn write_file(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("The sign-in folder is missing.")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("The sign-in folder could not be made: {error}"))?;
    oleafly_secrets::fs::write_atomic(path, content.as_bytes())
        .map_err(|error| format!("The sign-in entry could not be saved: {error}"))
}

fn remove_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("The sign-in entry could not be removed: {error}")),
    }
}

/// Adds or removes our entry; removing never touches anything else.
pub fn set(env: &LoginEnv, exec: &LoginExec, enabled: bool) -> Result<LoginItemState, String> {
    match env.platform {
        Platform::MacOs => {
            if enabled && translocated(exec) {
                return Ok(LoginItemState::MoveApp);
            }
            let path = plist_path(env);
            if enabled {
                write_file(&path, &launch_agent_plist(exec))?;
            } else {
                remove_file(&path)?;
            }
        }
        Platform::Windows => {
            let Some(registry) = &env.registry else {
                return Ok(no_registry());
            };
            if enabled {
                registry
                    .set(RUN_VALUE_NAME, &run_value(exec))
                    .map_err(|error| format!("The sign-in entry could not be saved: {error}"))?;
            } else if registry.get(RUN_VALUE_NAME).is_some() {
                registry
                    .delete(RUN_VALUE_NAME)
                    .map_err(|error| format!("The sign-in entry could not be removed: {error}"))?;
            }
        }
        Platform::Linux => {
            let path = autostart_path(env);
            if enabled {
                write_file(&path, &autostart_entry(exec))?;
            } else {
                remove_file(&path)?;
            }
        }
    }
    Ok(status(env, exec))
}

#[cfg(windows)]
pub mod windows {
    //! The `Run` key of the current user, through the registry API.
    use std::io;

    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
    };

    pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub struct HkcuRun {
        key: Vec<u16>,
    }

    impl HkcuRun {
        pub fn new(key: &str) -> Self {
            Self { key: wide(key) }
        }
    }

    impl super::RunRegistry for HkcuRun {
        fn get(&self, name: &str) -> Option<String> {
            let name = wide(name);
            let mut size: u32 = 0;
            let status = unsafe {
                RegGetValueW(
                    HKEY_CURRENT_USER,
                    self.key.as_ptr(),
                    name.as_ptr(),
                    RRF_RT_REG_SZ,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut size,
                )
            };
            if status != ERROR_SUCCESS || size == 0 {
                return None;
            }
            let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
            let status = unsafe {
                RegGetValueW(
                    HKEY_CURRENT_USER,
                    self.key.as_ptr(),
                    name.as_ptr(),
                    RRF_RT_REG_SZ,
                    std::ptr::null_mut(),
                    buffer.as_mut_ptr().cast(),
                    &mut size,
                )
            };
            if status != ERROR_SUCCESS {
                return None;
            }
            let end = buffer
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(buffer.len());
            Some(String::from_utf16_lossy(&buffer[..end]))
        }

        fn set(&self, name: &str, value: &str) -> io::Result<()> {
            let name = wide(name);
            let data = wide(value);
            let status = unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    self.key.as_ptr(),
                    name.as_ptr(),
                    REG_SZ,
                    data.as_ptr().cast(),
                    u32::try_from(data.len() * 2).unwrap_or(u32::MAX),
                )
            };
            if status == ERROR_SUCCESS {
                Ok(())
            } else {
                Err(io::Error::from_raw_os_error(status as i32))
            }
        }

        fn delete(&self, name: &str) -> io::Result<()> {
            let name = wide(name);
            let status =
                unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, self.key.as_ptr(), name.as_ptr()) };
            if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                Err(io::Error::from_raw_os_error(status as i32))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    use super::*;

    fn exec(program: &str) -> LoginExec {
        login_exec(Path::new(program), None)
    }

    #[derive(Default)]
    struct FakeRegistry(Mutex<BTreeMap<String, String>>);

    impl RunRegistry for FakeRegistry {
        fn get(&self, name: &str) -> Option<String> {
            self.0.lock().unwrap().get(name).cloned()
        }
        fn set(&self, name: &str, value: &str) -> io::Result<()> {
            self.0.lock().unwrap().insert(name.into(), value.into());
            Ok(())
        }
        fn delete(&self, name: &str) -> io::Result<()> {
            self.0.lock().unwrap().remove(name);
            Ok(())
        }
    }

    impl RunRegistry for std::sync::Arc<FakeRegistry> {
        fn get(&self, name: &str) -> Option<String> {
            self.as_ref().get(name)
        }
        fn set(&self, name: &str, value: &str) -> io::Result<()> {
            self.as_ref().set(name, value)
        }
        fn delete(&self, name: &str) -> io::Result<()> {
            self.as_ref().delete(name)
        }
    }

    fn env(platform: Platform, home: &Path) -> LoginEnv {
        LoginEnv {
            platform,
            home: home.to_path_buf(),
            xdg_config_home: None,
            registry: None,
        }
    }

    #[test]
    fn the_launch_agent_escapes_paths_and_runs_at_load() {
        let plist = launch_agent_plist(&exec(
            "/Applications/R&D Oleafly.app/Contents/MacOS/Oleafly",
        ));
        assert!(plist
            .contains("<string>/Applications/R&amp;D Oleafly.app/Contents/MacOS/Oleafly</string>"));
        assert!(plist.contains("<key>RunAtLoad</key>"));
        assert!(
            plist.contains("<string>--oleafly-daemon</string>")
                && plist.contains("<string>--at-login</string>")
        );
        assert!(plist.contains(LAUNCH_AGENT_LABEL));
    }

    #[test]
    fn the_run_value_quotes_the_executable() {
        assert_eq!(
            run_value(&exec(r"C:\Program Files\Oleafly\Oleafly.exe")),
            r#""C:\Program Files\Oleafly\Oleafly.exe" --oleafly-daemon --at-login"#
        );
        assert_eq!(
            run_value(&exec(
                r"C:\Users\Zoë Müller\AppData\Local\Oleafly\Oleafly.exe"
            )),
            r#""C:\Users\Zoë Müller\AppData\Local\Oleafly\Oleafly.exe" --oleafly-daemon --at-login"#
        );
    }

    #[test]
    fn the_autostart_entry_quotes_exec_and_names_try_exec() {
        let entry = autostart_entry(&exec("/home/zoë/Apps/Oleafly $1.AppImage"));
        // The Desktop Entry spec: a literal `$` in a quoted argument is `\\$`.
        assert!(
            entry.contains(
                r#"Exec="/home/zoë/Apps/Oleafly \\$1.AppImage" --oleafly-daemon --at-login"#
            ),
            "{entry}"
        );
        assert!(entry.contains("TryExec=/home/zoë/Apps/Oleafly $1.AppImage"));
        assert!(entry.contains("NoDisplay=true") && entry.contains("Type=Application"));
        let percent = autostart_entry(&exec("/opt/100% Oleafly/oleafly"));
        assert!(percent.contains(r#"Exec="/opt/100%% Oleafly/oleafly""#));
    }

    #[test]
    fn the_appimage_is_what_starts_at_sign_in() {
        let exec = login_exec(
            Path::new("/tmp/.mount_Olea/usr/bin/oleafly"),
            Some(Path::new("/home/me/Oleafly.AppImage")),
        );
        assert_eq!(exec.program, Path::new("/home/me/Oleafly.AppImage"));
        assert_eq!(exec.args, ["--oleafly-daemon", "--at-login"]);
    }

    #[test]
    fn enabling_twice_is_idempotent_and_disabling_removes_only_our_entry() {
        let home = tempfile::tempdir().unwrap();
        for platform in [Platform::MacOs, Platform::Linux] {
            let env = env(platform, home.path());
            let exec = exec("/opt/Oleafly/oleafly");
            assert_eq!(status(&env, &exec), LoginItemState::Disabled);
            assert_eq!(set(&env, &exec, true).unwrap(), LoginItemState::Enabled);
            assert_eq!(set(&env, &exec, true).unwrap(), LoginItemState::Enabled);
            // An entry for another copy of the app is not ours to report as on.
            assert_eq!(
                status(
                    &env,
                    &super::login_exec(Path::new("/elsewhere/oleafly"), None)
                ),
                LoginItemState::Disabled
            );
            assert_eq!(set(&env, &exec, false).unwrap(), LoginItemState::Disabled);
            assert_eq!(set(&env, &exec, false).unwrap(), LoginItemState::Disabled);
        }
        assert!(home.path().join("Library/LaunchAgents").is_dir());
        assert!(!home
            .path()
            .join("Library/LaunchAgents")
            .join(format!("{LAUNCH_AGENT_LABEL}.plist"))
            .exists());

        let registry = std::sync::Arc::new(FakeRegistry::default());
        registry
            .set("OneDrive", "\"C:\\OneDrive.exe\" /background")
            .unwrap();
        let windows = LoginEnv {
            platform: Platform::Windows,
            home: home.path().to_path_buf(),
            xdg_config_home: None,
            registry: Some(Box::new(registry.clone())),
        };
        let exec = exec(r"C:\Program Files\Oleafly\Oleafly.exe");
        assert_eq!(set(&windows, &exec, true).unwrap(), LoginItemState::Enabled);
        assert_eq!(set(&windows, &exec, true).unwrap(), LoginItemState::Enabled);
        assert_eq!(
            set(&windows, &exec, false).unwrap(),
            LoginItemState::Disabled
        );
        assert_eq!(
            registry.get("OneDrive").as_deref(),
            Some("\"C:\\OneDrive.exe\" /background")
        );
        assert!(registry.get(RUN_VALUE_NAME).is_none());
    }

    #[test]
    fn linux_follows_xdg_config_home() {
        let home = tempfile::tempdir().unwrap();
        let config = home.path().join("custom-config");
        let env = LoginEnv {
            xdg_config_home: Some(config.clone()),
            ..env(Platform::Linux, home.path())
        };
        set(&env, &exec("/usr/bin/oleafly"), true).unwrap();
        assert!(config.join("autostart").join(AUTOSTART_FILE).is_file());
    }

    #[test]
    fn a_translocated_mac_app_must_move_first() {
        let home = tempfile::tempdir().unwrap();
        let mac = env(Platform::MacOs, home.path());
        let translocated = exec(
            "/private/var/folders/xy/T/AppTranslocation/1/d/Oleafly.app/Contents/MacOS/Oleafly",
        );
        assert_eq!(status(&mac, &translocated), LoginItemState::MoveApp);
        assert_eq!(
            set(&mac, &translocated, true).unwrap(),
            LoginItemState::MoveApp
        );
        assert!(!home.path().join("Library/LaunchAgents").exists());
    }

    #[test]
    fn windows_without_a_registry_is_unsupported() {
        let home = tempfile::tempdir().unwrap();
        let state = status(
            &env(Platform::Windows, home.path()),
            &exec(r"C:\Oleafly.exe"),
        );
        assert!(matches!(state, LoginItemState::Unsupported { .. }));
        assert_eq!(
            serde_json::to_value(LoginItemState::MoveApp).unwrap(),
            serde_json::json!({"state": "move_app"})
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_real_registry_backend_round_trips_under_a_test_key() {
        let key = format!(r"Software\Oleafly\Tests\Run-{}", std::process::id());
        let registry = windows::HkcuRun::new(&key);
        registry
            .set(
                RUN_VALUE_NAME,
                r#""C:\Users\Zoë Müller\Oleafly.exe" --oleafly-daemon"#,
            )
            .unwrap();
        assert_eq!(
            registry.get(RUN_VALUE_NAME).as_deref(),
            Some(r#""C:\Users\Zoë Müller\Oleafly.exe" --oleafly-daemon"#)
        );
        registry.delete(RUN_VALUE_NAME).unwrap();
        assert!(registry.get(RUN_VALUE_NAME).is_none());
        registry.delete(RUN_VALUE_NAME).unwrap();
    }
}

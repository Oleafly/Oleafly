use std::ffi::{OsStr, OsString};
use std::path::PathBuf;

use tauri::Manager;

pub(crate) fn should_enable(
    debug_build: bool,
    e2e_build: bool,
    data_dir_override: Option<&OsStr>,
) -> bool {
    !debug_build && !e2e_build && data_dir_override.is_none_or(OsStr::is_empty)
}

pub(crate) fn args_are_forwardable(args: impl IntoIterator<Item = OsString>) -> bool {
    args.into_iter().all(|arg| arg.into_string().is_ok())
}

pub(crate) fn enabled_for_this_launch() -> bool {
    if !should_enable(
        cfg!(debug_assertions),
        cfg!(feature = "e2e-testing"),
        std::env::var_os("OLEAFLY_DATA_DIR").as_deref(),
    ) {
        return false;
    }
    if args_are_forwardable(std::env::args_os()) {
        return true;
    }
    let _ = crate::project::append_app_log(
        "Single instance was skipped because a launch argument is not valid Unicode.".to_string(),
    );
    false
}

pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(on_second_launch)
}

pub(crate) fn on_second_launch<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    args: Vec<String>,
    cwd: String,
) {
    reveal_main_window(app);
    crate::open_request::arrive(
        app,
        args.into_iter().map(OsString::from).collect(),
        Some(PathBuf::from(cwd)),
        crate::open_request::OpenSource::Forwarded,
    );
}

pub(crate) fn reveal_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_launches_use_a_single_instance() {
        assert!(should_enable(false, false, None));
        assert!(should_enable(false, false, Some(OsStr::new(""))));
    }

    #[test]
    fn debug_e2e_and_isolated_data_launches_run_side_by_side() {
        assert!(!should_enable(true, false, None));
        assert!(!should_enable(false, true, None));
        assert!(!should_enable(
            false,
            false,
            Some(OsStr::new("/tmp/oleafly-e2e"))
        ));
    }

    #[test]
    fn unicode_arguments_can_be_forwarded() {
        assert!(args_are_forwardable([
            OsString::from("/Applications/Oleafly.app/Contents/MacOS/Oleafly"),
            OsString::from("--open-folder"),
            OsString::from("/Users/me/Thèse #1 ✨/paper"),
        ]));
        assert!(args_are_forwardable(Vec::<OsString>::new()));
    }

    #[cfg(unix)]
    #[test]
    fn arguments_that_are_not_utf8_are_not_forwarded() {
        use std::os::unix::ffi::OsStringExt;
        assert!(!args_are_forwardable([
            OsString::from("oleafly"),
            OsString::from_vec(vec![b'/', b't', b'h', 0xe8, b's']),
        ]));
    }

    #[cfg(windows)]
    #[test]
    fn arguments_with_unpaired_surrogates_are_not_forwarded() {
        use std::os::windows::ffi::OsStringExt;
        assert!(!args_are_forwardable([
            OsString::from("Oleafly.exe"),
            OsString::from_wide(&[0x0044, 0x003a, 0xd800]),
        ]));
    }

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    const LAUNCH_WORKER: &str = "OLEAFLY_SINGLE_INSTANCE_LAUNCH_WORKER";

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    fn run_launch_worker(worker: &str, envs: &[(&str, &str)]) -> (bool, String) {
        use crate::proc::NoConsole;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};

        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .no_console()
            .args(["--exact", worker, "--test-threads=1", "--nocapture"])
            .env(LAUNCH_WORKER, "1")
            .envs(envs.iter().copied())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(60);
        while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let output = child.wait_with_output().unwrap();
        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).into_owned(),
        )
    }

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    fn launch_with_the_plugin(identifier: String) {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = identifier;
        tauri::test::mock_builder()
            .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
            .build(context)
            .unwrap();
    }

    fn app_built_like_run() -> tauri::App<tauri::test::MockRuntime> {
        crate::with_open_intake(
            tauri::test::mock_builder(),
            crate::open_request::OpenIntake::default(),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
    }

    fn queued(app: &tauri::App<tauri::test::MockRuntime>) -> Vec<(String, &'static str)> {
        app.state::<crate::open_request::OpenIntake>()
            .pending()
            .into_iter()
            .map(|request| {
                let source = match request.source {
                    crate::open_request::OpenSource::Forwarded => "forwarded",
                    _ => "other",
                };
                (request.display_name, source)
            })
            .collect()
    }

    #[cfg(unix)]
    #[test]
    fn a_second_launch_hands_its_folders_to_the_running_window() {
        let app = app_built_like_run();
        on_second_launch(
            app.handle(),
            vec![
                "/Applications/Oleafly.app/Contents/MacOS/Oleafly".into(),
                "--open-folder".into(),
                "thesis".into(),
                "/srv/notes".into(),
            ],
            "/home/me/work".into(),
        );
        on_second_launch(app.handle(), vec!["oleafly".into()], "/home/me".into());
        assert_eq!(
            queued(&app),
            [
                ("thesis".to_string(), "forwarded"),
                ("notes".to_string(), "forwarded"),
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_second_launch_hands_its_folders_to_the_running_window() {
        let app = app_built_like_run();
        on_second_launch(
            app.handle(),
            vec![
                r"C:\Program Files\Oleafly\Oleafly.exe".into(),
                "--open-folder".into(),
                "thesis".into(),
                r"D:\notes".into(),
            ],
            r"C:\Users\me\work".into(),
        );
        on_second_launch(
            app.handle(),
            vec![r"C:\Program Files\Oleafly\Oleafly.exe".into()],
            r"C:\Users\me".into(),
        );
        assert_eq!(
            queued(&app),
            [
                ("thesis".to_string(), "forwarded"),
                ("notes".to_string(), "forwarded"),
            ]
        );
    }

    #[cfg(target_os = "macos")]
    const IDENTIFIER: &str = "OLEAFLY_SINGLE_INSTANCE_TEST_IDENTIFIER";

    #[cfg(target_os = "macos")]
    fn per_user_temp_dir() -> PathBuf {
        use std::os::unix::ffi::OsStringExt;
        let mut buffer = vec![0u8; 1024];
        let needed = unsafe {
            libc::confstr(
                libc::_CS_DARWIN_USER_TEMP_DIR,
                buffer.as_mut_ptr().cast(),
                buffer.len(),
            )
        };
        assert!(needed > 0 && needed <= buffer.len());
        buffer.truncate(needed - 1);
        PathBuf::from(OsString::from_vec(buffer))
    }

    #[cfg(target_os = "macos")]
    fn socket_name(identifier: &str) -> String {
        format!("{}_si.sock", identifier.replace(['.', '-'], "_"))
    }

    #[cfg(target_os = "macos")]
    fn listen(path: &std::path::Path) -> std::os::unix::net::UnixListener {
        let _ = std::fs::remove_file(path);
        let listener = std::os::unix::net::UnixListener::bind(path).unwrap();
        listener.set_nonblocking(true).unwrap();
        listener
    }

    #[cfg(target_os = "macos")]
    fn heard(listener: &std::os::unix::net::UnixListener) -> Option<String> {
        use std::io::Read;
        let (mut stream, _) = listener.accept().ok()?;
        stream.set_nonblocking(false).unwrap();
        let mut text = String::new();
        stream.read_to_string(&mut text).unwrap();
        Some(text)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_socket_planted_in_the_shared_tmp_folder_is_never_used() {
        let identifier = format!("com.oleafly.si-test.planted.{}", std::process::id());
        let planted = PathBuf::from("/tmp").join(socket_name(&identifier));
        let listener = listen(&planted);
        let (finished, stdout) = run_launch_worker(
            "single_instance::tests::launch_worker_with_a_given_identifier",
            &[(IDENTIFIER, &identifier)],
        );
        let reached = heard(&listener);
        let _ = std::fs::remove_file(&planted);
        let _ = std::fs::remove_file(per_user_temp_dir().join(socket_name(&identifier)));
        assert!(finished && stdout.contains("1 passed"), "{stdout}");
        assert_eq!(reached, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_second_launch_reaches_the_instance_in_the_per_user_folder() {
        let identifier = format!("com.oleafly.si-test.user.{}", std::process::id());
        let socket = per_user_temp_dir().join(socket_name(&identifier));
        let listener = listen(&socket);
        let (finished, stdout) = run_launch_worker(
            "single_instance::tests::launch_worker_with_a_given_identifier",
            &[(IDENTIFIER, &identifier)],
        );
        let reached = heard(&listener);
        let _ = std::fs::remove_file(&socket);
        assert!(finished && !stdout.contains("1 passed"), "{stdout}");
        let text = reached.expect("the second launch never reached the running instance");
        assert!(
            text.contains("launch_worker_with_a_given_identifier"),
            "{text}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn launch_worker_with_a_given_identifier() {
        if std::env::var_os(LAUNCH_WORKER).is_none() {
            return;
        }
        let identifier = std::env::var(IDENTIFIER).unwrap();
        launch_with_the_plugin(identifier);
    }

    #[cfg(windows)]
    struct RunningInstance {
        mutex: windows_sys::Win32::Foundation::HANDLE,
        release: std::sync::mpsc::Sender<()>,
        owner: std::thread::JoinHandle<()>,
    }

    #[cfg(windows)]
    impl RunningInstance {
        fn start(identifier: &str, answers: bool) -> Self {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
            use windows_sys::Win32::System::Threading::CreateMutexW;
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                CreateWindowExW, DispatchMessageW, PeekMessageW, RegisterClassExW, MSG, PM_REMOVE,
                WNDCLASSEXW,
            };

            let wide = |suffix: &str| -> Vec<u16> {
                OsStr::new(&format!("{identifier}-{suffix}"))
                    .encode_wide()
                    .chain(Some(0))
                    .collect()
            };
            let mutex_name = wide("sim");
            let class_name = wide("sic");
            let window_name = wide("siw");
            let mutex = unsafe { CreateMutexW(std::ptr::null(), 1, mutex_name.as_ptr()) };
            assert!(!mutex.is_null());
            let (created, window_created) = std::sync::mpsc::channel();
            let (release, released) = std::sync::mpsc::channel::<()>();
            let owner = std::thread::spawn(move || {
                let window = unsafe {
                    let module = GetModuleHandleW(std::ptr::null());
                    let class = WNDCLASSEXW {
                        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                        lpfnWndProc: Some(record_forwarded_launch),
                        hInstance: module,
                        lpszClassName: class_name.as_ptr(),
                        ..std::mem::zeroed()
                    };
                    RegisterClassExW(&class);
                    CreateWindowExW(
                        0,
                        class_name.as_ptr(),
                        window_name.as_ptr(),
                        0,
                        0,
                        0,
                        0,
                        0,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        module,
                        std::ptr::null(),
                    )
                };
                created.send(!window.is_null()).unwrap();
                if !answers {
                    released.recv().unwrap();
                    return;
                }
                let mut message: MSG = unsafe { std::mem::zeroed() };
                while released.try_recv().is_err() {
                    while unsafe {
                        PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE)
                    } != 0
                    {
                        unsafe { DispatchMessageW(&message) };
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            });
            assert!(window_created.recv().unwrap());
            Self {
                mutex,
                release,
                owner,
            }
        }

        fn stop(self) {
            self.release.send(()).unwrap();
            self.owner.join().unwrap();
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.mutex) };
        }
    }

    #[cfg(windows)]
    unsafe extern "system" fn record_forwarded_launch(
        window: windows_sys::Win32::Foundation::HWND,
        message: u32,
        wparam: windows_sys::Win32::Foundation::WPARAM,
        lparam: windows_sys::Win32::Foundation::LPARAM,
    ) -> windows_sys::Win32::Foundation::LRESULT {
        use windows_sys::Win32::UI::WindowsAndMessaging::{DefWindowProcW, WM_COPYDATA};

        if message == WM_COPYDATA {
            println!("forwarded launch");
            return 1;
        }
        unsafe { DefWindowProcW(window, message, wparam, lparam) }
    }

    #[cfg(windows)]
    fn test_identifier(role: &str) -> String {
        format!(
            "com.oleafly.single-instance-test.{role}.{}",
            std::process::id()
        )
    }

    #[cfg(windows)]
    #[test]
    fn a_launch_hands_its_arguments_to_a_responsive_instance_and_exits() {
        let (finished, stdout) = run_launch_worker(
            "single_instance::tests::launch_worker_beside_a_responsive_instance",
            &[],
        );
        assert!(
            finished && stdout.contains("forwarded launch") && !stdout.contains("1 passed"),
            "{stdout}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn launch_worker_beside_a_responsive_instance() {
        if std::env::var_os(LAUNCH_WORKER).is_none() {
            return;
        }
        let identifier = test_identifier("responsive");
        let instance = RunningInstance::start(&identifier, true);
        launch_with_the_plugin(identifier);
        instance.stop();
    }

    #[cfg(windows)]
    #[test]
    fn a_launch_does_not_hang_when_the_running_instance_stops_responding() {
        let (finished, stdout) = run_launch_worker(
            "single_instance::tests::launch_worker_beside_an_unresponsive_instance",
            &[],
        );
        assert!(finished && stdout.contains("1 passed"), "{stdout}");
    }

    #[cfg(windows)]
    #[test]
    fn launch_worker_beside_an_unresponsive_instance() {
        if std::env::var_os(LAUNCH_WORKER).is_none() {
            return;
        }
        let identifier = test_identifier("unresponsive");
        let instance = RunningInstance::start(&identifier, false);
        launch_with_the_plugin(identifier);
        instance.stop();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_session_bus_address_zbus_cannot_parse_does_not_stop_the_launch() {
        for address in ["disabled:", ""] {
            let (finished, stdout) = run_launch_worker(
                "single_instance::tests::launch_worker_with_an_unparseable_session_bus_address",
                &[("DBUS_SESSION_BUS_ADDRESS", address)],
            );
            assert!(
                finished && stdout.contains("1 passed"),
                "{address:?}: {stdout}"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn launch_worker_with_an_unparseable_session_bus_address() {
        if std::env::var_os(LAUNCH_WORKER).is_none() {
            return;
        }
        launch_with_the_plugin(format!(
            "com.oleafly.single-instance-test.p{}",
            std::process::id()
        ));
    }
}

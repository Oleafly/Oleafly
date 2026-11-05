use super::*;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

#[derive(Clone)]
enum Reply {
    Bytes(Vec<u8>),
    Status(u16),
    Unmeasured(Vec<u8>),
    Stall { sent: Vec<u8>, claimed: u64 },
}

struct TestServer {
    url: String,
    ranges: Arc<Mutex<Vec<Option<u64>>>>,
}

fn requested_range(head: &str) -> Option<u64> {
    head.lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("range: bytes=")
                .map(str::to_owned)
        })
        .and_then(|value| value.trim_end_matches('-').trim().parse().ok())
}

async fn answer(stream: &mut tokio::net::TcpStream, reply: &Reply, range: Option<u64>) {
    match reply {
        Reply::Status(status) => {
            let head = format!("HTTP/1.1 {status} Nope\r\nContent-Length: 0\r\n\r\n");
            let _ = stream.write_all(head.as_bytes()).await;
        }
        Reply::Bytes(body) => {
            let start = range.unwrap_or(0) as usize;
            let rest = &body[start..];
            let status = if range.is_some() {
                "206 Partial Content"
            } else {
                "200 OK"
            };
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\n\r\n",
                rest.len()
            );
            let _ = stream.write_all(head.as_bytes()).await;
            let _ = stream.write_all(rest).await;
        }
        Reply::Unmeasured(body) => {
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                .await;
            let _ = stream.write_all(body).await;
        }
        Reply::Stall { sent, claimed } => {
            let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {claimed}\r\n\r\n");
            let _ = stream.write_all(head.as_bytes()).await;
            let _ = stream.write_all(sent).await;
            let _ = stream.flush().await;
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
        }
    }
}

async fn spawn_server(reply: Reply) -> TestServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/asset", listener.local_addr().unwrap());
    let ranges = Arc::new(Mutex::new(Vec::new()));
    let seen = ranges.clone();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut head = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                match stream.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(read) => head.extend_from_slice(&buffer[..read]),
                }
            }
            let range = requested_range(&String::from_utf8_lossy(&head));
            seen.lock().unwrap().push(range);
            let reply = reply.clone();
            tokio::spawn(async move { answer(&mut stream, &reply, range).await });
        }
    });
    TestServer { url, ranges }
}

fn asset_of(bytes: u64) -> TinytexAsset {
    TinytexAsset {
        expected_bytes: bytes,
        ..tinytex_asset_for("linux", "x86_64").unwrap()
    }
}

fn body(bytes: usize) -> Vec<u8> {
    (0..bytes).map(|index| (index % 251) as u8).collect()
}

async fn fetch(
    path: &Path,
    expected: u64,
    urls: &[&str],
    stall: std::time::Duration,
    cancel: &crate::toolchain_download::CancelToken,
) -> Result<(), String> {
    let asset = asset_of(expected);
    TinytexDownload {
        path,
        asset: &asset,
        stall,
        cancel,
        progress: |_| {},
    }
    .run(urls)
    .await
}

fn code_of(error: &str) -> String {
    crate::app_error::code(error).unwrap_or_else(|| panic!("not coded: {error}"))
}

const LONG: std::time::Duration = std::time::Duration::from_secs(30);

#[tokio::test]
async fn a_stalled_source_falls_back_and_resumes_from_the_saved_bytes() {
    let data = body(4096);
    let stalled = spawn_server(Reply::Stall {
        sent: data[..1024].to_vec(),
        claimed: 4096,
    })
    .await;
    let mirror = spawn_server(Reply::Bytes(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");

    fetch(
        &path,
        4096,
        &[&stalled.url, &mirror.url],
        std::time::Duration::from_millis(200),
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap();

    assert_eq!(std::fs::read(&path).unwrap(), data);
    assert_eq!(*mirror.ranges.lock().unwrap(), vec![Some(1024)]);
}

#[tokio::test]
async fn a_lone_stalled_source_ends_in_a_coded_error_and_keeps_the_partial_file() {
    let stalled = spawn_server(Reply::Stall {
        sent: vec![1; 512],
        claimed: 4096,
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");

    let error = fetch(
        &path,
        4096,
        &[&stalled.url],
        std::time::Duration::from_millis(200),
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_download_stalled");
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 512);
}

#[tokio::test]
async fn a_refused_source_falls_back_and_the_first_failure_is_the_one_reported() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");
    let forbidden = spawn_server(Reply::Status(403)).await;
    let absent = spawn_server(Reply::Status(404)).await;

    let error = fetch(
        &path,
        4096,
        &[&forbidden.url, &absent.url],
        LONG,
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_download_refused");
    assert!(error.contains("403"), "{error}");
    assert!(!error.contains("127.0.0.1"), "{error}");
    assert_eq!(absent.ranges.lock().unwrap().len(), 1);

    let data = body(2048);
    let working = spawn_server(Reply::Bytes(data.clone())).await;
    fetch(
        &path,
        2048,
        &[&forbidden.url, &working.url],
        LONG,
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), data);
}

#[tokio::test]
async fn an_unreachable_source_never_shows_the_network_library_text() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/asset", listener.local_addr().unwrap());
    drop(listener);
    let dir = tempfile::tempdir().unwrap();

    let error = fetch(
        &dir.path().join("download"),
        4096,
        &[&url],
        LONG,
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_download_failed");
    assert!(!error.contains("error sending request"), "{error}");
}

#[tokio::test]
async fn cancelling_stops_the_stream_and_keeps_the_partial_file() {
    let stalled = spawn_server(Reply::Stall {
        sent: vec![1; 1024],
        claimed: 4096,
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");
    let cancel = crate::toolchain_download::CancelToken::new();
    let asset = asset_of(4096);

    let error = TinytexDownload {
        path: &path,
        asset: &asset,
        stall: LONG,
        cancel: &cancel,
        progress: |_| cancel.cancel(),
    }
    .run(&[&stalled.url, &stalled.url])
    .await
    .unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_install_cancelled");
    assert!(std::fs::metadata(&path).unwrap().len() > 0);
    assert_eq!(stalled.ranges.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cancelling_before_any_bytes_does_not_open_a_connection() {
    let server = spawn_server(Reply::Status(500)).await;
    let dir = tempfile::tempdir().unwrap();
    let cancel = crate::toolchain_download::CancelToken::new();
    cancel.cancel();

    let error = fetch(
        &dir.path().join("download"),
        4096,
        &[&server.url],
        LONG,
        &cancel,
    )
    .await
    .unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_install_cancelled");
    assert!(server.ranges.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_body_past_the_pinned_size_is_discarded_and_reported_as_a_bad_download() {
    let server = spawn_server(Reply::Unmeasured(body(8192))).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");

    let error = fetch(
        &path,
        4096,
        &[&server.url],
        LONG,
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_verification_failed");
    assert!(!path.exists());
}

#[tokio::test]
async fn a_short_body_keeps_its_bytes_and_says_how_far_it_got() {
    let server = spawn_server(Reply::Unmeasured(body(2_500_000))).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");

    let error = fetch(
        &path,
        5_000_000,
        &[&server.url],
        LONG,
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_download_interrupted");
    let english = crate::app_error::english(&error).unwrap();
    assert!(english.contains("2 of 5 MB"), "{english}");
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 2_500_000);
}

#[tokio::test]
async fn a_server_claiming_the_wrong_size_is_skipped() {
    let wrong = spawn_server(Reply::Bytes(body(100))).await;
    let data = body(2048);
    let right = spawn_server(Reply::Bytes(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");

    fetch(
        &path,
        2048,
        &[&wrong.url, &right.url],
        LONG,
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap();

    assert_eq!(std::fs::read(&path).unwrap(), data);
}

#[tokio::test]
async fn a_finished_download_is_not_fetched_again() {
    let server = spawn_server(Reply::Status(500)).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download");
    std::fs::write(&path, body(4096)).unwrap();

    fetch(
        &path,
        4096,
        &[&server.url],
        LONG,
        &crate::toolchain_download::CancelToken::new(),
    )
    .await
    .unwrap();

    assert!(server.ranges.lock().unwrap().is_empty());
}

#[test]
fn every_asset_lists_the_oleafly_mirror_first_and_then_github() {
    for (os, arch) in [
        ("windows", "x86_64"),
        ("macos", "aarch64"),
        ("macos", "x86_64"),
        ("linux", "x86_64"),
        ("linux", "aarch64"),
    ] {
        let asset = tinytex_asset_for(os, arch).unwrap();
        let [first, second] = asset.download_urls();
        assert!(first.starts_with("https://mirrors.oleafly.com/binaries/tinytex/"));
        assert!(first.contains(TINYTEX_TAG));
        assert!(second.starts_with("https://github.com/rstudio/tinytex-releases/"));
        assert_eq!(
            oleafly_core::download_sources::DownloadSettings::default()
                .arrange(&[&second, &first], &std::collections::HashSet::new()),
            [first.clone(), second.clone()]
        );
        assert_eq!(
            first.rsplit('/').next().unwrap(),
            second.rsplit('/').next().unwrap()
        );
    }
}

#[test]
fn unsupported_platforms_get_a_coded_error() {
    for (os, arch) in [("windows", "aarch64"), ("freebsd", "x86_64")] {
        let error = tinytex_asset_for(os, arch).unwrap_err();
        assert_eq!(code_of(&error), "tex.tinytex_unsupported_platform");
        let english = crate::app_error::english(&error).unwrap();
        assert!(english.contains(os) && english.contains(arch), "{english}");
    }
}

#[test]
fn perl_failures_are_recognised_from_what_the_shell_and_perl_print() {
    let missing_module = perl_gap_error(
        "Can't locate File/Find.pm in @INC (you may need to install the File::Find module) (@INC entries checked: /etc/perl) at tlmgr line 89.",
    )
    .unwrap();
    assert_eq!(missing_module.code, "tex.perl_module_missing");
    assert_eq!(
        missing_module.params.get("module").map(String::as_str),
        Some("File::Find")
    );
    for text in [
        "env: 'perl': No such file or directory",
        "/usr/bin/env: \u{2018}perl\u{2019}: No such file or directory",
        "/bin/sh: bad interpreter: /usr/bin/perl: no such file",
    ] {
        assert_eq!(perl_gap_error(text).unwrap().code, "tex.perl_missing");
    }
    assert!(perl_gap_error("kpathsea: configuration file texmf.cnf not found").is_none());
    assert!(perl_gap_error("Can't locate the font").is_none());
}

#[tokio::test]
async fn no_perl_at_all_is_refused_before_any_download() {
    let error = check_tinytex_perl(None).await.unwrap_err();
    assert_eq!(code_of(&error), "tex.perl_missing");
}

#[cfg(unix)]
#[tokio::test]
async fn the_perl_check_asks_for_every_module_tlmgr_and_latexmk_load() {
    let dir = tempfile::tempdir().unwrap();
    let calls = dir.path().join("calls");
    let perl = dir.path().join("perl");
    super::tests::write_test_script(
        &perl,
        &format!("#!/bin/sh\nprintf '%s' \"$2\" > '{}'\n", calls.display()),
    );

    check_tinytex_perl(Some(&perl)).await.unwrap();

    let script = std::fs::read_to_string(&calls).unwrap();
    for module in ["File::Find", "File::Copy", "Time::HiRes", "Digest::SHA"] {
        assert!(script.contains(&format!("use {module};")), "{script}");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_partial_perl_names_the_module_it_lacks() {
    let dir = tempfile::tempdir().unwrap();
    let perl = dir.path().join("perl");
    super::tests::write_test_script(
        &perl,
        "#!/bin/sh\necho \"Can't locate Time/HiRes.pm in @INC (you may need to install the Time::HiRes module)\" >&2\nexit 2\n",
    );

    let error = check_tinytex_perl(Some(&perl)).await.unwrap_err();

    assert_eq!(code_of(&error), "tex.perl_module_missing");
    assert!(error.contains("Time::HiRes"), "{error}");
}

#[cfg(unix)]
#[tokio::test]
async fn a_perl_that_fails_for_another_reason_does_not_block_the_install() {
    let dir = tempfile::tempdir().unwrap();
    let perl = dir.path().join("perl");
    super::tests::write_test_script(&perl, "#!/bin/sh\necho 'segfault' >&2\nexit 139\n");
    check_tinytex_perl(Some(&perl)).await.unwrap();
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn the_install_gate_turns_a_perl_failure_into_the_coded_error() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    super::tests::write_test_script(
        &bin.join("tlmgr"),
        "#!/bin/sh\necho \"env: 'perl': No such file or directory\" >&2\nexit 127\n",
    );
    let error = validate_tinytex_tool(&bin.join("lualatex"), "tlmgr")
        .await
        .unwrap_err();
    assert_eq!(code_of(&error), "tex.perl_missing");
    assert_eq!(staged_validation_error(error.clone()), error);
}

#[cfg(all(unix, not(target_os = "linux")))]
#[tokio::test]
async fn outside_linux_a_perl_failure_keeps_the_tool_output_instead_of_linux_advice() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    super::tests::write_test_script(
        &bin.join("tlmgr"),
        "#!/bin/sh\necho \"Can't locate TeXLive/TLUtils.pm in @INC\" >&2\nexit 2\n",
    );
    let error = validate_tinytex_tool(&bin.join("lualatex"), "tlmgr")
        .await
        .unwrap_err();
    assert!(error.contains("TinyTeX tlmgr validation failed"), "{error}");
    assert!(error.contains("Can't locate TeXLive/TLUtils.pm"), "{error}");
    let staged = staged_validation_error(error);
    assert_eq!(code_of(&staged), "tex.tinytex_validation_failed");
    assert!(
        staged.contains("Can't locate TeXLive/TLUtils.pm"),
        "{staged}"
    );
}

#[test]
fn a_refused_folder_is_left_alone_while_the_profile_install_is_still_removed() {
    let data = Path::new("data");
    let refused = tinytex_path_error(data);
    let profile = tinytex_paths_in(data).to_vec();

    assert_eq!(
        tinytex_paths_to_delete(Err(refused.clone()), profile.clone()),
        Ok(profile.clone())
    );
    assert_eq!(
        tinytex_paths_to_delete(Err(refused.clone()), Vec::new()),
        Err(refused)
    );

    let moved = Path::new("moved");
    let mut both = tinytex_paths_in(moved).to_vec();
    both.extend(profile.clone());
    assert_eq!(
        tinytex_paths_to_delete(Ok(moved.to_owned()), profile),
        Ok(both)
    );
}

#[test]
fn only_linux_reads_a_tool_failure_as_a_gap_in_the_system_perl() {
    let quarantined = "Can't locate TeXLive/TLUtils.pm in @INC (@INC contains: C:/tlpkg/tlperl/lib) at tlmgr.pl line 89.";
    let no_interpreter = "env: 'perl': No such file or directory";
    assert_eq!(
        perl_gap_for("linux", quarantined).unwrap().code,
        "tex.perl_module_missing"
    );
    assert_eq!(
        perl_gap_for("linux", no_interpreter).unwrap().code,
        "tex.perl_missing"
    );
    for os in ["windows", "macos"] {
        assert!(perl_gap_for(os, quarantined).is_none(), "{os}");
        assert!(perl_gap_for(os, no_interpreter).is_none(), "{os}");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_tree_kpathsea_cannot_read_fails_the_gate() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let lualatex = bin.join("lualatex");

    validate_tinytex_kpathsea(&lualatex).await.unwrap();

    super::tests::write_test_script(
        &bin.join("kpsewhich"),
        "#!/bin/sh\necho 'kpathsea: configuration file texmf.cnf not found' >&2\nexit 1\n",
    );
    let error = validate_tinytex_kpathsea(&lualatex).await.unwrap_err();
    assert!(error.contains("texmf.cnf"), "{error}");

    let kpsewhich = bin.join("kpsewhich");
    std::fs::remove_file(&kpsewhich).unwrap();
    super::tests::write_test_script(
        &kpsewhich,
        "#!/bin/sh\ncase \"$1\" in --var-value=*) echo /opt/tinytex ;; esac\n",
    );
    let error = validate_tinytex_kpathsea(&lualatex).await.unwrap_err();
    assert!(error.contains("lualatex.fmt"), "{error}");

    std::fs::remove_file(&kpsewhich).unwrap();
    super::tests::write_test_script(&kpsewhich, "#!/bin/sh\necho /opt/tinytex/found\n");
    validate_tinytex_kpathsea(&lualatex).await.unwrap();
}

#[tokio::test]
#[ignore = "needs an unpacked TinyTeX; set TINYTEX_TREE to the folder holding it"]
async fn a_real_tinytex_tree_passes_the_install_gate() {
    let root = PathBuf::from(std::env::var("TINYTEX_TREE").expect("set TINYTEX_TREE"));
    let info = validate_tinytex_executables(&root).await.unwrap();
    assert!(info.tlmgr.is_some() && info.latexmk.is_some());
}

#[test]
#[ignore = "set TINYTEX_FONTS_CONF to a fonts.conf taken from the Windows archive"]
fn the_real_windows_fonts_conf_is_rewritten() {
    let path = std::env::var("TINYTEX_FONTS_CONF").expect("set TINYTEX_FONTS_CONF");
    let original = std::fs::read(path).unwrap();
    let rewritten = relative_tinytex_font_dirs(&original).unwrap();
    let text = String::from_utf8(rewritten.clone()).unwrap();
    assert_eq!(text.matches("runneradmin").count(), 0, "{text}");
    assert_eq!(text.matches("prefix=\"relative\"").count(), 2, "{text}");
    assert!(text.contains("hiragino"), "{text}");
    assert_eq!(relative_tinytex_font_dirs(&rewritten), None);
}

#[test]
fn only_oleaflys_own_lualatex_gets_the_slow_start_budget() {
    assert_eq!(probe_timeout_for_kind("tinytex"), TINYTEX_START_TIMEOUT);
    assert_eq!(probe_timeout_for_kind("system"), TEX_PROBE_TIMEOUT);
}

const PINNED_FONTS_CONF: &str = "<?xml version=\"1.0\"?>\n<fontconfig>\n<dir>C:/Windows/fonts</dir>\n<dir>C:/Users/runneradmin/AppData/Roaming/TinyTeX/texmf-dist/fonts/opentype</dir>\n<dir>C:/Users/runneradmin/AppData/Roaming/TinyTeX/texmf-dist/fonts/truetype</dir>\n<cachedir>C:/x</cachedir>\n</fontconfig>\n";

#[test]
fn font_folders_stop_pointing_at_the_build_machine() {
    let rewritten = relative_tinytex_font_dirs(PINNED_FONTS_CONF.as_bytes()).unwrap();
    let text = String::from_utf8(rewritten.clone()).unwrap();
    assert!(!text.contains("runneradmin"), "{text}");
    assert!(text.contains("<dir>C:/Windows/fonts</dir>"), "{text}");
    assert!(
        text.contains("<dir prefix=\"relative\">../../../texmf-dist/fonts/opentype</dir>"),
        "{text}"
    );
    assert!(
        text.contains("<dir prefix=\"relative\">../../../texmf-dist/fonts/truetype</dir>"),
        "{text}"
    );
    assert_eq!(relative_tinytex_font_dirs(&rewritten), None);
}

#[test]
fn font_folders_keep_line_endings_and_survive_bytes_that_are_not_utf8() {
    let crlf = PINNED_FONTS_CONF.replace('\n', "\r\n");
    let rewritten = relative_tinytex_font_dirs(crlf.as_bytes()).unwrap();
    assert_eq!(
        rewritten.iter().filter(|byte| **byte == b'\n').count(),
        crlf.matches('\n').count()
    );
    assert!(String::from_utf8(rewritten).unwrap().contains("</dir>\r\n"));

    let mut raw = b"  <dir>C:/Users/Jos".to_vec();
    raw.push(0xe9);
    raw.extend_from_slice(b"/TinyTeX/texmf-dist/fonts/opentype</dir>\n");
    let rewritten = relative_tinytex_font_dirs(&raw).unwrap();
    assert_eq!(
        rewritten,
        b"  <dir prefix=\"relative\">../../../texmf-dist/fonts/opentype</dir>\n"
    );
    assert_eq!(
        relative_tinytex_font_dirs(b"<dir>C:/Windows/fonts</dir>\n"),
        None
    );
}

#[test]
fn the_fonts_conf_inside_a_staged_tree_is_rewritten_once() {
    let root = tempfile::tempdir().unwrap();
    let tree = root.path().join("TinyTeX");
    let bin = tree
        .join("bin")
        .join(oleafly_core::tex_distro::host_platform_dirs()[0]);
    std::fs::create_dir_all(&bin).unwrap();
    let conf = tree.join("texmf-var/fonts/conf/fonts.conf");

    relative_fonts_conf(root.path()).unwrap();

    std::fs::create_dir_all(conf.parent().unwrap()).unwrap();
    std::fs::write(&conf, PINNED_FONTS_CONF).unwrap();
    relative_fonts_conf(root.path()).unwrap();
    let text = std::fs::read_to_string(&conf).unwrap();
    assert!(!text.contains("runneradmin"), "{text}");
    assert!(text.contains("prefix=\"relative\""), "{text}");
    relative_fonts_conf(root.path()).unwrap();
    assert_eq!(std::fs::read_to_string(&conf).unwrap(), text);
}

#[test]
fn wrapped_errors_stay_decodable_and_never_nest_an_envelope() {
    let inner: String = crate::app_error::AppError::new("tex.no_host_binary")
        .param("name", "lualatex")
        .into();
    let wrapped = staged_validation_error(inner);
    assert_eq!(code_of(&wrapped), "tex.tinytex_validation_failed");
    assert_eq!(wrapped.matches(crate::app_error::PREFIX).count(), 1);
    assert!(wrapped.contains("lualatex"), "{wrapped}");

    let plain = coded_install_error("disk exploded".to_string());
    assert_eq!(code_of(&plain), "tex.tinytex_install_failed");
    assert!(plain.contains("disk exploded"), "{plain}");
    assert_eq!(coded_install_error(wrapped.clone()), wrapped);
}

#[test]
fn archive_failures_are_told_apart_from_disk_failures() {
    let integrity = unpack_error(
        "TinyTeX archive member manifest does not match the reviewed release.".to_string(),
    );
    assert_eq!(code_of(&integrity), "tex.tinytex_integrity_failed");
    let disk = unpack_error("No space left on device".to_string());
    assert_eq!(code_of(&disk), "tex.tinytex_unpack_failed");
    let cancelled = install_cancelled_error();
    assert_eq!(unpack_error(cancelled.clone()), cancelled);
}

#[test]
fn a_locked_folder_gets_the_antivirus_advice() {
    assert_eq!(
        publish_error(&std::io::Error::from_raw_os_error(if cfg!(windows) {
            32
        } else {
            13
        }))
        .code,
        "tex.tinytex_publish_locked"
    );
    assert_eq!(
        publish_error(&std::io::Error::other("cross-device link")).code,
        "tex.tinytex_publish_failed"
    );
}

#[test]
fn publishing_into_a_vanished_parent_reports_a_coded_error_and_keeps_the_old_tree() {
    let root = tempfile::tempdir().unwrap();
    let staging = root.path().join("missing.installing");
    let destination = root.path().join("tinytex");
    let backup = root.path().join("tinytex.previous");
    std::fs::create_dir_all(&backup).unwrap();
    std::fs::write(backup.join("marker"), "kept").unwrap();

    let error = publish_or_restore(&staging, &destination, &backup, true).unwrap_err();

    assert_eq!(code_of(&error), "tex.tinytex_publish_failed");
    assert_eq!(
        std::fs::read_to_string(destination.join("marker")).unwrap(),
        "kept"
    );
}

#[test]
fn installer_errors_have_english_messages() {
    use crate::app_error::AppError;
    for error in [
        AppError::new("tex.tinytex_path_not_ascii").param("path", "C:\\Users\\x"),
        AppError::new("tex.tinytex_disk_space")
            .param("needed", "2.0")
            .param("free", "0.5"),
        AppError::new("tex.tinytex_download_failed"),
        AppError::new("tex.tinytex_download_refused").param("status", 403),
        AppError::new("tex.tinytex_download_stalled").param("seconds", 60),
        AppError::new("tex.tinytex_download_interrupted")
            .param("received", 2)
            .param("total", 5),
        AppError::new("tex.tinytex_download_write_failed"),
        AppError::new("tex.tinytex_verification_failed"),
        AppError::new("tex.tinytex_integrity_failed"),
        AppError::new("tex.tinytex_unpack_failed"),
        AppError::new("tex.tinytex_validation_failed"),
        AppError::new("tex.tinytex_publish_locked"),
        AppError::new("tex.tinytex_publish_failed"),
        AppError::new("tex.tinytex_rollback_failed"),
        AppError::new("tex.tinytex_install_busy"),
        AppError::new("tex.tinytex_install_cancelled"),
        AppError::new("tex.tinytex_install_failed"),
        AppError::new("tex.tinytex_unsupported_platform")
            .param("os", "windows")
            .param("arch", "aarch64"),
        AppError::new("tex.perl_missing"),
        AppError::new("tex.perl_module_missing").param("module", "File::Find"),
        AppError::new("tex.distribution_unknown").param("path", "/opt/tex"),
    ] {
        let text = String::from(error);
        let english = crate::app_error::english(&text).unwrap_or_default();
        assert!(!english.is_empty(), "{text}");
        assert!(!english.contains("{{"), "{english}");
    }
}

#[test]
fn a_tex_utility_keeps_no_appimage_library_paths() {
    #[cfg(unix)]
    {
        let image = crate::proc::SimulatedAppImage::start();
        let command = tex_utility_command(
            Path::new("/opt/TinyTeX/bin/x86_64-linux/tlmgr"),
            &["--version".to_string()],
        )
        .unwrap();
        let env: Vec<_> = command.as_std().get_envs().collect();
        let value = |name: &str| {
            env.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| *value)
        };
        assert_eq!(value("LD_LIBRARY_PATH"), Some(None));
        assert_eq!(value("PYTHONHOME"), Some(None));
        assert_eq!(
            value("PERLLIB"),
            Some(Some(std::ffi::OsStr::new("/opt/perl")))
        );
        assert!(matches!(value("PATH"), Some(Some(_))));

        let bundled = tex_utility_command(&image.root.join("usr/bin/tectonic"), &[]).unwrap();
        assert!(!bundled
            .as_std()
            .get_envs()
            .any(|(key, _)| key == "LD_LIBRARY_PATH"));
    }
}

#[test]
fn a_stopped_extraction_is_reported_as_a_stop() {
    use std::io::Write as _;
    let dir = tempfile::tempdir().unwrap();
    let archive = dir.path().join("TinyTeX.zip");
    let mut writer = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    writer
        .start_file(
            "TinyTeX/readme.txt",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    writer.write_all(b"hello").unwrap();
    writer.finish().unwrap();

    let file = std::fs::File::open(&archive).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    assert_eq!(zip.len(), 1);
    assert!(zip.by_index(0).is_ok());

    let asset = TinytexAsset {
        format: ArchiveFormat::Zip,
        ..asset_of(5)
    };
    let error = crate::tinytex_archive::extract_all_until(
        &archive,
        asset.format,
        asset.member_policy(),
        &dir.path().join("staging"),
        &|| true,
    )
    .unwrap_err();
    assert!(!error.is_empty());
}

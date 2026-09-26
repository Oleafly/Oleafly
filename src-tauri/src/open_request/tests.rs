use super::*;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const UNIX: ParseRules = ParseRules {
    file_urls: false,
    windows_paths: false,
};
const MAC: ParseRules = ParseRules {
    file_urls: true,
    windows_paths: false,
};

fn argv(items: &[&str]) -> Vec<OsString> {
    std::iter::once("oleafly")
        .chain(items.iter().copied())
        .map(OsString::from)
        .collect()
}

fn folders(targets: Vec<LaunchTarget>) -> Vec<PathBuf> {
    targets
        .into_iter()
        .map(|target| match target {
            LaunchTarget::Folder(path) => path,
            other => panic!("{other:?}"),
        })
        .collect()
}

fn refusal(targets: Vec<LaunchTarget>) -> (String, OpenFolderError) {
    match targets.as_slice() {
        [LaunchTarget::Refused { name, error }] => (name.clone(), error.clone()),
        other => panic!("{other:?}"),
    }
}

#[cfg(unix)]
#[test]
fn the_open_folder_flag_and_bare_paths_both_name_folders() {
    let cwd = Path::new("/home/me");
    assert_eq!(
        folders(parse_argv(
            &argv(&["--open-folder", "/srv/thesis", "/srv/notes"]),
            Some(cwd),
            UNIX
        )),
        [PathBuf::from("/srv/thesis"), PathBuf::from("/srv/notes")]
    );
    assert_eq!(
        folders(parse_argv(
            &argv(&["--open-folder=/srv/paper"]),
            Some(cwd),
            UNIX
        )),
        [PathBuf::from("/srv/paper")]
    );
}

#[cfg(unix)]
#[test]
fn flags_are_skipped_until_a_double_dash_ends_them() {
    let cwd = Path::new("/home/me");
    assert!(parse_argv(&argv(&["-psn_0_1234", "--verbose", ""]), Some(cwd), UNIX).is_empty());
    assert!(parse_argv(&argv(&[]), Some(cwd), UNIX).is_empty());
    assert!(parse_argv(&argv(&["--open-folder"]), Some(cwd), UNIX).is_empty());
    assert_eq!(
        folders(parse_argv(&argv(&["--", "-draft"]), Some(cwd), UNIX)),
        [PathBuf::from("/home/me/-draft")]
    );
}

#[cfg(unix)]
#[test]
fn paths_keep_spaces_hashes_percents_nfd_and_emoji_exactly() {
    let cwd = Path::new("/home/me");
    let names = [
        "/srv/My Thesis",
        "/srv/paper #2",
        "/srv/50% done",
        "/srv/Th\u{65}\u{301}se",
        "/srv/notes \u{1F33F}",
        "/srv/a%20b",
    ];
    for name in names {
        assert_eq!(
            folders(parse_argv(&argv(&[name]), Some(cwd), MAC)),
            [PathBuf::from(name)],
            "{name}"
        );
    }
}

#[cfg(unix)]
#[test]
fn relative_paths_resolve_against_the_forwarded_working_directory() {
    let cwd = Path::new("/home/me/work");
    assert_eq!(
        folders(parse_argv(&argv(&["thesis", "."]), Some(cwd), UNIX)),
        [
            PathBuf::from("/home/me/work/thesis"),
            PathBuf::from("/home/me/work/.")
        ]
    );
}

#[test]
fn a_relative_path_without_a_working_directory_is_refused() {
    for cwd in [None, Some(Path::new("")), Some(Path::new("relative/dir"))] {
        assert_eq!(
            refusal(parse_argv(&argv(&["thesis"]), cwd, UNIX)),
            ("thesis".to_string(), OpenFolderError::NotAbsolute),
            "{cwd:?}"
        );
    }
}

#[cfg(unix)]
#[test]
fn file_urls_are_decoded_only_where_the_platform_sends_them() {
    let cwd = Path::new("/home/me");
    let url = "file:///Users/me/Th%C3%A8se%20%231%20%F0%9F%8C%BF/";
    assert_eq!(
        folders(parse_argv(&argv(&[url]), Some(cwd), MAC)),
        [PathBuf::from("/Users/me/Th\u{e8}se #1 \u{1F33F}/")]
    );
    assert_eq!(
        folders(parse_argv(
            &argv(&["FILE://localhost/Users/me/Th%65%CC%81se"]),
            Some(cwd),
            MAC
        )),
        [PathBuf::from("/Users/me/Th\u{65}\u{301}se")]
    );
    assert_eq!(
        refusal(parse_argv(&argv(&[url]), Some(cwd), UNIX)).1,
        OpenFolderError::NotAbsolute
    );
}

#[cfg(unix)]
#[test]
fn urls_that_are_not_plain_local_folders_are_refused() {
    let cwd = Path::new("/home/me");
    for url in [
        "https://example.com/thesis",
        "oleafly://open?path=/srv/x",
        "file://server/share/thesis",
        "file:///srv/thesis?x=1",
        "file:///srv/thesis#frag",
    ] {
        assert_eq!(
            refusal(parse_argv(&argv(&[url]), Some(cwd), MAC)).1,
            OpenFolderError::NotAbsolute,
            "{url}"
        );
    }
}

#[test]
fn the_windows_drive_root_quote_artifact_is_repaired() {
    assert_eq!(repair_drive_quote("D:\""), "D:\\");
    assert_eq!(repair_drive_quote("d:\""), "d:\\");
    assert_eq!(
        repair_drive_quote("C:\\Users\\me\\thesis\""),
        "C:\\Users\\me\\thesis"
    );
    assert_eq!(
        repair_drive_quote("C:\\Users\\me\\thesis"),
        "C:\\Users\\me\\thesis"
    );
    assert_eq!(repair_drive_quote("\""), "\"");
}

#[cfg(windows)]
#[test]
fn a_windows_drive_root_argument_becomes_the_drive_root() {
    let rules = ParseRules {
        file_urls: false,
        windows_paths: true,
    };
    assert_eq!(
        folders(parse_argv(
            &argv(&["--open-folder", "D:\""]),
            Some(Path::new("C:\\Users\\me")),
            rules
        )),
        [PathBuf::from("D:\\")]
    );
}

#[cfg(unix)]
#[test]
fn an_argument_that_is_not_unicode_is_refused_by_name() {
    use std::os::unix::ffi::OsStringExt;
    let mut args = argv(&["--open-folder"]);
    args.push(OsString::from_vec(b"/srv/th\xe8se".to_vec()));
    args.push(OsString::from_vec(b"/srv/\xffpaper".to_vec()));
    let targets = parse_argv(&args, Some(Path::new("/home/me")), UNIX);
    assert_eq!(targets.len(), 2);
    for target in targets {
        match target {
            LaunchTarget::Refused { name, error } => {
                assert_eq!(error, OpenFolderError::NotUnicode);
                assert!(name.contains('\u{fffd}'), "{name}");
            }
            other => panic!("{other:?}"),
        }
    }
}

#[cfg(windows)]
#[test]
fn an_argument_with_an_unpaired_surrogate_is_refused() {
    use std::os::windows::ffi::OsStringExt;
    let mut args = argv(&[]);
    args.push(OsString::from_wide(&[0x0044, 0x003a, 0x005c, 0xd800]));
    let (_, error) = refusal(parse_argv(
        &args,
        Some(Path::new("C:\\")),
        ParseRules::native(),
    ));
    assert_eq!(error, OpenFolderError::NotUnicode);
}

fn folder(path: &str) -> LaunchTarget {
    LaunchTarget::Folder(PathBuf::from(path))
}

fn ready(path: &str) -> Result<ValidatedFolder, Refusal> {
    Ok(ValidatedFolder {
        canonical: PathBuf::from(path),
        identity: None,
    })
}

fn tokens(pending: &[PendingOpen]) -> Vec<String> {
    pending
        .iter()
        .map(|request| request.token.clone())
        .collect()
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn anyone() -> Caller {
    Caller {
        window: "main".into(),
        session: None,
    }
}

fn page(session: u64) -> Caller {
    Caller {
        window: "main".into(),
        session: Some(session),
    }
}

#[test]
fn tokens_are_random_and_a_claimed_token_can_never_be_replayed() {
    let intake = OpenIntake::default();
    let first = intake.enqueue(vec![folder("/srv/thesis")], OpenSource::Forwarded);
    let second = intake.enqueue(vec![folder("/srv/notes")], OpenSource::Picker);
    let token = first[0].token.clone();
    assert_eq!(token.len(), 32);
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(token, second[0].token);
    assert_eq!(first[0].display_name, "thesis");
    intake.settle(&token, ready("/srv/thesis"));
    assert_eq!(
        block_on(intake.claim(&token, &anyone(), Duration::from_millis(50))),
        Claim::Ready(ValidatedFolder {
            canonical: PathBuf::from("/srv/thesis"),
            identity: None,
        })
    );
    assert_eq!(
        block_on(intake.claim(&token, &anyone(), Duration::from_millis(50))),
        Claim::Expired
    );
    assert_eq!(
        block_on(intake.claim(
            "0123456789abcdef0123456789abcdef",
            &anyone(),
            Duration::from_millis(50)
        )),
        Claim::Expired
    );
}

#[test]
fn pending_lists_arrivals_in_order_and_never_picker_requests() {
    let intake = OpenIntake::default();
    let launch = intake.enqueue(vec![folder("/srv/a"), folder("/srv/b")], OpenSource::Launch);
    intake.enqueue(vec![folder("/srv/picked")], OpenSource::Picker);
    let forwarded = intake.enqueue(vec![folder("/srv/c")], OpenSource::Forwarded);
    let pending = intake.pending();
    assert_eq!(
        tokens(&pending),
        [
            launch[0].token.clone(),
            launch[1].token.clone(),
            forwarded[0].token.clone()
        ]
    );
    assert_eq!(pending[2].source, OpenSource::Forwarded);
    assert_eq!(intake.pending(), pending);
}

#[test]
fn identical_arrivals_coalesce_into_one_request() {
    let intake = OpenIntake::default();
    let first = intake.enqueue(vec![folder("/srv/thesis")], OpenSource::Forwarded);
    let again = intake.enqueue(
        vec![folder("/srv/thesis"), folder("/srv/thesis")],
        OpenSource::Forwarded,
    );
    assert_eq!(tokens(&again), [first[0].token.clone()]);
    assert_eq!(intake.pending().len(), 1);
    let picked = intake.enqueue(vec![folder("/srv/thesis")], OpenSource::Picker);
    assert_ne!(picked[0].token, first[0].token);
}

#[test]
fn claiming_an_arrival_supersedes_older_arrivals_but_not_picker_requests() {
    let intake = OpenIntake::default();
    let older = intake.enqueue(
        vec![folder("/srv/a"), folder("/srv/b")],
        OpenSource::Forwarded,
    );
    let picked = intake.enqueue(vec![folder("/srv/p")], OpenSource::Picker);
    let newest = intake.enqueue(vec![folder("/srv/c")], OpenSource::Forwarded);
    let later = intake.enqueue(vec![folder("/srv/d")], OpenSource::Forwarded);
    for (token, path) in [
        (&newest[0].token, "/srv/c"),
        (&picked[0].token, "/srv/p"),
        (&older[0].token, "/srv/a"),
    ] {
        intake.settle(token, ready(path));
    }
    assert!(matches!(
        block_on(intake.claim(&newest[0].token, &anyone(), Duration::from_millis(50))),
        Claim::Ready(_)
    ));
    assert_eq!(tokens(&intake.pending()), [later[0].token.clone()]);
    assert_eq!(
        block_on(intake.claim(&older[0].token, &anyone(), Duration::from_millis(50))),
        Claim::Expired
    );
    assert!(matches!(
        block_on(intake.claim(&picked[0].token, &anyone(), Duration::from_millis(50))),
        Claim::Ready(_)
    ));
}

#[test]
fn the_queue_keeps_the_newest_sixteen_requests() {
    let intake = OpenIntake::default();
    let created: Vec<PendingOpen> = (0..20)
        .flat_map(|index| {
            intake.enqueue(
                vec![folder(&format!("/srv/f{index}"))],
                OpenSource::Forwarded,
            )
        })
        .collect();
    let pending = intake.pending();
    assert_eq!(pending.len(), 16);
    assert_eq!(pending[0].token, created[4].token);
    assert_eq!(pending[15].token, created[19].token);
}

#[test]
fn refused_targets_are_queued_so_the_window_can_explain_them() {
    let intake = OpenIntake::default();
    let refused = intake.enqueue(
        vec![LaunchTarget::Refused {
            name: "thesis".into(),
            error: OpenFolderError::NotAbsolute,
        }],
        OpenSource::Forwarded,
    );
    assert!(intake.begin_validation().is_empty());
    assert_eq!(refused[0].display_name, "thesis");
    assert_eq!(
        block_on(intake.claim(&refused[0].token, &anyone(), Duration::from_millis(50))),
        Claim::Refused(Refusal {
            error: OpenFolderError::NotAbsolute,
            browse: None,
        })
    );
}

#[test]
fn each_unsettled_request_is_handed_out_for_validation_once() {
    let intake = OpenIntake::default();
    let requests = intake.enqueue(vec![folder("/srv/a"), folder("/srv/b")], OpenSource::Launch);
    intake.settle(&requests[0].token, ready("/srv/a"));
    assert_eq!(
        intake.begin_validation(),
        [(requests[1].token.clone(), PathBuf::from("/srv/b"))]
    );
    assert!(intake.begin_validation().is_empty());
    assert_eq!(
        block_on(intake.claim(&requests[1].token, &anyone(), Duration::from_millis(30))),
        Claim::TimedOut
    );
}

#[test]
fn a_claim_waits_for_validation_to_settle() {
    let intake = Arc::new(OpenIntake::default());
    let request = intake.enqueue(vec![folder("/srv/slow")], OpenSource::Forwarded);
    let token = request[0].token.clone();
    let settler = Arc::clone(&intake);
    let settled_token = token.clone();
    let worker = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        settler.settle(
            &settled_token,
            Err(Refusal {
                error: OpenFolderError::TooBroad {
                    name: "Documents".into(),
                },
                browse: Some(PathBuf::from("/Users/me/Documents")),
            }),
        );
    });
    let claim = block_on(intake.claim(&token, &anyone(), Duration::from_secs(5)));
    worker.join().unwrap();
    assert_eq!(
        claim,
        Claim::Refused(Refusal {
            error: OpenFolderError::TooBroad {
                name: "Documents".into()
            },
            browse: Some(PathBuf::from("/Users/me/Documents")),
        })
    );
}

#[test]
fn a_claim_that_outlasts_validation_times_out_and_forgets_the_request() {
    let intake = OpenIntake::default();
    let request = intake.enqueue(vec![folder("/Volumes/offline")], OpenSource::Forwarded);
    assert_eq!(
        block_on(intake.claim(&request[0].token, &anyone(), Duration::from_millis(30))),
        Claim::TimedOut
    );
    assert!(intake.pending().is_empty());
    intake.settle(&request[0].token, ready("/Volumes/offline"));
    assert!(intake.pending().is_empty());
}

#[test]
fn browse_scopes_are_opaque_tickets_that_resolve_back_to_their_folder() {
    let intake = OpenIntake::default();
    let ticket = intake.remember_scope(PathBuf::from("/Users/me/Documents"));
    assert_eq!(ticket.len(), 32);
    assert!(!ticket.contains("Documents"));
    assert_eq!(
        intake.scope(&ticket),
        Some(PathBuf::from("/Users/me/Documents"))
    );
    assert_eq!(intake.scope("not-a-ticket"), None);
    for index in 0..8 {
        intake.remember_scope(PathBuf::from(format!("/srv/{index}")));
    }
    assert_eq!(intake.scope(&ticket), None);
}

#[test]
fn the_single_window_router_focuses_an_open_project_and_switches_otherwise() {
    let router = SingleWindowRouter;
    assert_eq!(router.arrival_window(), "main");
    assert_eq!(
        router.placement("linked-a", Some("linked-a")),
        Placement::Focus
    );
    assert_eq!(
        router.placement("linked-a", Some("linked-b")),
        Placement::SwitchInPlace
    );
    assert_eq!(router.placement("linked-a", None), Placement::SwitchInPlace);
}

#[cfg(unix)]
#[test]
fn a_restart_never_replays_the_folder_its_launch_already_opened() {
    let launch = argv(&["--open-folder", "/srv/thesis"]);
    let cwd = Some(Path::new("/home/me"));
    let (targets, guard) = launch_targets_from(&launch, cwd, None, UNIX);
    assert_eq!(folders(targets), [PathBuf::from("/srv/thesis")]);
    let guard = guard.expect("a launch that opens a folder marks its arguments");
    assert_eq!(guard, argv_fingerprint(&launch));
    let (replayed, kept) = launch_targets_from(&launch, cwd, Some(OsStr::new(&guard)), UNIX);
    assert!(replayed.is_empty());
    assert_eq!(kept.as_deref(), Some(guard.as_str()));
    let other = argv(&["--open-folder", "/srv/notes"]);
    let (fresh, _) = launch_targets_from(&other, cwd, Some(OsStr::new(&guard)), UNIX);
    assert_eq!(folders(fresh), [PathBuf::from("/srv/notes")]);
    let (none, unmarked) = launch_targets_from(&argv(&[]), cwd, None, UNIX);
    assert!(none.is_empty());
    assert_eq!(unmarked, None);
}

#[test]
fn the_argument_fingerprint_ignores_the_program_path_and_is_stable() {
    let a = vec![
        OsString::from("/Applications/Oleafly.app/Contents/MacOS/Oleafly"),
        OsString::from("/srv/thesis"),
    ];
    let b = vec![OsString::from("oleafly"), OsString::from("/srv/thesis")];
    let c = vec![OsString::from("oleafly"), OsString::from("/srv/thesis2")];
    let d = vec![
        OsString::from("oleafly"),
        OsString::from("/srv/the"),
        OsString::from("sis"),
    ];
    assert_eq!(argv_fingerprint(&a), argv_fingerprint(&b));
    assert_ne!(argv_fingerprint(&b), argv_fingerprint(&c));
    assert_ne!(argv_fingerprint(&b), argv_fingerprint(&d));
    assert_eq!(argv_fingerprint(&b), argv_fingerprint(&b.clone()));
}

#[test]
fn the_intake_exists_before_setup_so_early_arrivals_are_never_lost() {
    use tauri::Manager;
    let intake = OpenIntake::default();
    let cold = intake.enqueue(vec![folder("/srv/thesis")], OpenSource::Launch);
    let setup_ran = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let marker = Arc::clone(&setup_ran);
    let app = tauri::test::mock_builder()
        .manage(intake)
        .setup(move |_| {
            marker.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    assert!(!setup_ran.load(std::sync::atomic::Ordering::SeqCst));
    let early = app
        .state::<OpenIntake>()
        .enqueue(vec![folder("/srv/notes")], OpenSource::Forwarded);
    assert_eq!(
        tokens(&app.state::<OpenIntake>().pending()),
        [cold[0].token.clone(), early[0].token.clone()]
    );
}

struct DataDir {
    _guard: std::sync::MutexGuard<'static, ()>,
    temp: tempfile::TempDir,
    previous: Option<OsString>,
}

impl DataDir {
    fn new() -> Self {
        let guard = crate::paths::data_dir_env_lock();
        let temp = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::fs::create_dir(temp.path().join("data")).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", temp.path().join("data"));
        Self {
            _guard: guard,
            temp,
            previous,
        }
    }

    fn folder(&self, relative: &str, files: &[(&str, &str)]) -> PathBuf {
        let root = self.temp.path().join(relative);
        std::fs::create_dir_all(&root).unwrap();
        for (path, text) in files {
            let file = root.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, text).unwrap();
        }
        root.canonicalize().unwrap()
    }
}

impl Drop for DataDir {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
    }
}

const ARTICLE: &str = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";

fn opened(path: &Path, shown: Option<&str>) -> OpenedFolderReply {
    open_validated(path, shown, &SingleWindowRouter).unwrap()
}

#[test]
fn validation_records_the_canonical_folder_and_its_identity() {
    let data = DataDir::new();
    let thesis = data.folder("work/thesis", &[("main.tex", ARTICLE)]);
    let validated = validate(&data.temp.path().join("work/./thesis")).unwrap();
    assert_eq!(validated.canonical, thesis);
    assert_eq!(
        validated.identity,
        Some(
            crate::fs_identity::identify_directory(&thesis)
                .unwrap()
                .identity
        )
    );
}

#[test]
fn a_broad_folder_is_refused_with_a_scope_to_browse_inside_it() {
    let data = DataDir::new();
    let Ok(home) = crate::paths::home_dir() else {
        return;
    };
    let home = home.canonicalize().unwrap();
    let refusal = validate(&home).unwrap_err();
    assert!(
        matches!(refusal.error, OpenFolderError::TooBroad { .. }),
        "{refusal:?}"
    );
    assert_eq!(refusal.browse, Some(home));
    let missing = validate(&data.temp.path().join("definitely/not/here")).unwrap_err();
    assert_eq!(
        missing,
        Refusal {
            error: OpenFolderError::NotFound,
            browse: None,
        }
    );
}

#[test]
fn opening_a_folder_with_one_clear_main_remembers_it_for_the_editor() {
    let data = DataDir::new();
    let thesis = data.folder(
        "work/thesis",
        &[("paper/main.tex", ARTICLE), ("notes.md", "notes")],
    );
    let reply = opened(&thesis, None);
    assert!(
        reply.project_id.starts_with("linked-"),
        "{}",
        reply.project_id
    );
    assert_eq!(reply.detection.decision, oleafly_core::Decision::Auto);
    assert_eq!(reply.detection.main.as_deref(), Some("paper/main.tex"));
    let meta = crate::project::read_meta(&reply.project_id).unwrap();
    assert_eq!(meta.main_doc, "paper/main.tex");
    assert!(!thesis.join("project.json").exists());
    assert!(!thesis.join(".oleafly").exists());
    let again = opened(&thesis, None);
    assert_eq!(again.project_id, reply.project_id);
    assert_eq!(
        again.detection.source,
        oleafly_core::DetectionSource::SavedChoice
    );
}

#[test]
fn an_ambiguous_folder_is_left_for_the_person_to_choose() {
    let data = DataDir::new();
    let folder = data.folder(
        "work/papers",
        &[("alpha/report.tex", ARTICLE), ("beta/report.tex", ARTICLE)],
    );
    let reply = opened(&folder, None);
    assert_eq!(reply.detection.decision, oleafly_core::Decision::Ask);
    assert_eq!(reply.detection.main, None);
    assert!(crate::project::linked_listing_meta(&reply.project_id).is_none());
}

#[test]
fn a_folder_already_showing_is_focused_without_changing_its_main_document() {
    let data = DataDir::new();
    let folder = data.folder(
        "work/papers",
        &[("alpha/report.tex", ARTICLE), ("beta/report.tex", ARTICLE)],
    );
    let first = opened(&folder, None);
    std::fs::remove_file(folder.join("beta/report.tex")).unwrap();
    let focused = opened(&folder, Some(&first.project_id));
    assert_eq!(focused.project_id, first.project_id);
    assert_eq!(focused.detection.main.as_deref(), Some("alpha/report.tex"));
    assert!(crate::project::linked_listing_meta(&first.project_id).is_none());
    opened(&folder, Some("linked-00000000000000000000000000000000"));
    assert_eq!(
        crate::project::read_meta(&first.project_id)
            .unwrap()
            .main_doc,
        "alpha/report.tex"
    );
}

#[test]
fn reopening_a_folder_marks_it_as_the_most_recently_opened() {
    let data = DataDir::new();
    let folder = data.folder("work/thesis", &[("main.tex", ARTICLE)]);
    let reply = opened(&folder, None);
    crate::linked_registry::update(&reply.project_id, |record| {
        record.last_opened_at = 1;
        Ok(())
    })
    .unwrap();
    opened(&folder, None);
    let record = crate::linked_registry::get(&reply.project_id)
        .unwrap()
        .unwrap();
    assert!(record.last_opened_at > 1, "{}", record.last_opened_at);
}

#[test]
fn a_library_folder_opens_its_library_project_with_its_saved_main() {
    let _data = DataDir::new();
    let project = crate::paths::projects_root().unwrap().join("thesis-1");
    std::fs::create_dir_all(project.join("chapters")).unwrap();
    std::fs::write(project.join("thesis.tex"), ARTICLE).unwrap();
    std::fs::write(
        project.join("project.json"),
        r#"{"name":"Thesis","main_doc":"thesis.tex"}"#,
    )
    .unwrap();
    let reply = opened(&project.join("chapters"), None);
    assert_eq!(reply.project_id, "thesis-1");
    assert_eq!(reply.detection.main.as_deref(), Some("thesis.tex"));
    assert_eq!(
        reply.detection.source,
        oleafly_core::DetectionSource::SavedChoice
    );
    assert!(crate::linked_registry::list().unwrap().is_empty());
}

#[test]
fn a_folder_that_became_broad_is_refused_when_it_is_opened() {
    let _data = DataDir::new();
    let Ok(home) = crate::paths::home_dir() else {
        return;
    };
    match open_validated(&home, None, &SingleWindowRouter) {
        Err(OpenFailure::Refused(refusal)) => {
            assert!(matches!(refusal.error, OpenFolderError::TooBroad { .. }));
            assert_eq!(refusal.browse, Some(home.canonicalize().unwrap()));
        }
        other => panic!("{other:?}"),
    }
}

fn decoded(error: &str) -> serde_json::Value {
    serde_json::from_str(error.strip_prefix(crate::app_error::PREFIX).unwrap()).unwrap()
}

#[test]
fn claims_become_folders_or_translatable_refusals() {
    let intake = OpenIntake::default();
    let folder = ValidatedFolder {
        canonical: PathBuf::from("/srv/thesis"),
        identity: None,
    };
    assert_eq!(
        claimed_folder(&intake, Claim::Ready(folder.clone())),
        Ok(folder)
    );
    assert_eq!(
        decoded(&claimed_folder(&intake, Claim::Expired).unwrap_err())["code"],
        "open_folder.request_expired"
    );
    assert_eq!(
        decoded(&claimed_folder(&intake, Claim::TimedOut).unwrap_err())["code"],
        "open_folder.timed_out"
    );
    let broad = decoded(
        &claimed_folder(
            &intake,
            Claim::Refused(Refusal {
                error: OpenFolderError::TooBroad {
                    name: "Documents".into(),
                },
                browse: Some(PathBuf::from("/Users/me/Documents")),
            }),
        )
        .unwrap_err(),
    );
    assert_eq!(broad["code"], "open_folder.too_broad");
    assert_eq!(broad["params"]["name"], "Documents");
    let ticket = broad["params"]["browse"].as_str().unwrap();
    assert_eq!(
        intake.scope(ticket),
        Some(PathBuf::from("/Users/me/Documents"))
    );
    let missing = decoded(
        &claimed_folder(
            &intake,
            Claim::Refused(Refusal {
                error: OpenFolderError::NotFound,
                browse: None,
            }),
        )
        .unwrap_err(),
    );
    assert_eq!(missing["code"], "open_folder.not_found");
    assert!(missing["params"].get("browse").is_none());
}

#[test]
fn a_refused_warm_arrival_is_announced_to_the_window() {
    use tauri::Listener;
    let app = tauri::test::mock_builder()
        .manage(OpenIntake::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let heard = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let sink = Arc::clone(&heard);
    app.listen_any(OPEN_REQUEST_EVENT, move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    let relative = arrive(
        app.handle(),
        argv(&["thesis"]),
        Some(PathBuf::new()),
        OpenSource::Forwarded,
    );
    let remote = arrive_targets(
        app.handle(),
        vec![OsString::from("https://example.com/notes")],
        None,
        OpenSource::Os,
    );
    let heard = heard.lock().unwrap();
    assert_eq!(heard.len(), 2, "{heard:?}");
    assert_eq!(heard[0]["token"], relative[0].token.as_str());
    assert_eq!(heard[0]["display_name"], "thesis");
    assert_eq!(heard[0]["source"], "forwarded");
    assert_eq!(heard[1]["token"], remote[0].token.as_str());
    assert_eq!(heard[1]["source"], "os");
    assert_eq!(
        block_on(app.state::<OpenIntake>().claim(
            &relative[0].token,
            &anyone(),
            Duration::from_millis(50)
        )),
        Claim::Refused(Refusal {
            error: OpenFolderError::NotAbsolute,
            browse: None,
        })
    );
}

#[cfg(unix)]
#[test]
fn an_os_open_list_keeps_every_entry_and_reads_no_flags() {
    let entries = [
        OsString::from("file:///srv/thesis/"),
        OsString::from("/srv/notes"),
        OsString::from("--open-folder"),
    ];
    let mut targets = parse_targets(&entries, None, MAC);
    let flag = targets.pop().unwrap();
    assert_eq!(
        folders(targets),
        [PathBuf::from("/srv/thesis/"), PathBuf::from("/srv/notes")]
    );
    assert_eq!(
        flag,
        LaunchTarget::Refused {
            name: "--open-folder".into(),
            error: OpenFolderError::NotAbsolute,
        }
    );
    assert!(parse_targets(&[], None, MAC).is_empty());
}

#[cfg(unix)]
#[test]
fn display_names_step_out_of_parent_folders_and_follow_the_validated_folder() {
    let cwd = Path::new("/home/me/work");
    let intake = OpenIntake::default();
    let pending = intake.enqueue(
        parse_argv(&argv(&["..", "."]), Some(cwd), UNIX),
        OpenSource::Forwarded,
    );
    assert_eq!(
        pending
            .iter()
            .map(|request| request.display_name.as_str())
            .collect::<Vec<_>>(),
        ["me", "work"]
    );
    assert_eq!(display_name(Path::new("/srv/a/../b/./c/..")), "b");
    assert_eq!(display_name(Path::new("/..")), "/");
    assert_eq!(display_name(Path::new("../thesis")), "thesis");
    intake.settle(&pending[0].token, ready("/Users/me/Thesis"));
    assert_eq!(intake.pending()[0].display_name, "Thesis");
}

#[test]
fn inspecting_a_request_keeps_it_until_it_is_claimed_or_declined() {
    let intake = OpenIntake::default();
    let older = intake.enqueue(vec![folder("/srv/a")], OpenSource::Forwarded);
    let request = intake.enqueue(vec![folder("/srv/b")], OpenSource::Forwarded);
    let token = request[0].token.clone();
    intake.settle(&token, ready("/srv/b"));
    for _ in 0..2 {
        assert_eq!(
            block_on(intake.inspect(&token, &anyone(), Duration::from_millis(50))),
            Claim::Ready(ValidatedFolder {
                canonical: PathBuf::from("/srv/b"),
                identity: None,
            })
        );
    }
    assert_eq!(
        tokens(&intake.pending()),
        [older[0].token.clone(), token.clone()]
    );
    intake.discard(&token, &anyone());
    assert!(intake.pending().is_empty());
    assert_eq!(
        block_on(intake.claim(&token, &anyone(), Duration::from_millis(50))),
        Claim::Expired
    );
}

#[test]
fn inspecting_a_refused_request_hands_over_the_refusal_once() {
    let intake = OpenIntake::default();
    let refused = intake.enqueue(
        vec![LaunchTarget::Refused {
            name: "thesis".into(),
            error: OpenFolderError::NotAbsolute,
        }],
        OpenSource::Forwarded,
    );
    let token = &refused[0].token;
    assert!(matches!(
        block_on(intake.inspect(token, &anyone(), Duration::from_millis(50))),
        Claim::Refused(_)
    ));
    assert_eq!(
        block_on(intake.inspect(token, &anyone(), Duration::from_millis(50))),
        Claim::Expired
    );
}

#[test]
fn a_reload_hands_an_unfinished_claim_back_to_the_new_page() {
    let intake = OpenIntake::default();
    let old = intake.begin_session("main");
    let request = intake.enqueue(vec![folder("/srv/thesis")], OpenSource::Forwarded);
    let token = request[0].token.clone();
    intake.settle(&token, ready("/srv/thesis"));
    assert!(matches!(
        block_on(intake.claim(&token, &page(old), Duration::from_millis(50))),
        Claim::Ready(_)
    ));
    assert!(intake.pending().is_empty());

    let new = intake.begin_session("main");
    assert!(new > old);
    assert_eq!(tokens(&intake.pending()), std::slice::from_ref(&token));
    intake.finish(&token);
    assert_eq!(tokens(&intake.pending()), std::slice::from_ref(&token));
    assert!(matches!(
        block_on(intake.claim(&token, &page(new), Duration::from_millis(50))),
        Claim::Ready(_)
    ));
    intake.finish(&token);
    intake.begin_session("main");
    assert!(intake.pending().is_empty());
}

#[test]
fn a_claim_from_a_page_that_reloaded_never_consumes_the_request() {
    let intake = Arc::new(OpenIntake::default());
    let old = intake.begin_session("main");
    let request = intake.enqueue(vec![folder("/srv/slow")], OpenSource::Forwarded);
    let token = request[0].token.clone();
    let waiter = {
        let intake = Arc::clone(&intake);
        let token = token.clone();
        std::thread::spawn(move || {
            block_on(intake.claim(&token, &page(old), Duration::from_secs(5)))
        })
    };
    std::thread::sleep(Duration::from_millis(30));
    let new = intake.begin_session("main");
    intake.settle(&token, ready("/srv/slow"));
    assert_eq!(waiter.join().unwrap(), Claim::Expired);
    assert_eq!(tokens(&intake.pending()), std::slice::from_ref(&token));
    assert!(matches!(
        block_on(intake.claim(&token, &page(new), Duration::from_millis(50))),
        Claim::Ready(_)
    ));
}

#[test]
fn a_page_that_reloaded_can_neither_decline_nor_time_out_a_request() {
    let intake = OpenIntake::default();
    let old = intake.begin_session("main");
    let new = intake.begin_session("main");
    intake.begin_session("preview");
    let request = intake.enqueue(vec![folder("/srv/thesis")], OpenSource::Forwarded);
    let token = request[0].token.clone();
    intake.discard(&token, &page(old));
    assert_eq!(
        block_on(intake.claim(&token, &page(old), Duration::from_millis(20))),
        Claim::Expired
    );
    assert_eq!(tokens(&intake.pending()), std::slice::from_ref(&token));
    intake.discard(&token, &page(new));
    assert!(intake.pending().is_empty());
}

#[test]
fn previewing_a_folder_names_its_project_without_registering_it() {
    let data = DataDir::new();
    let thesis = data.folder("work/thesis", &[("chapters/intro.tex", ARTICLE)]);
    assert_eq!(
        preview(&thesis),
        Ok(OpenPreview {
            project_id: None,
            display_name: "thesis".into(),
        })
    );
    assert!(crate::linked_registry::list().unwrap().is_empty());
    let reply = opened(&thesis, None);
    assert_eq!(
        preview(&thesis).unwrap().project_id.as_deref(),
        Some(reply.project_id.as_str())
    );
    assert_eq!(
        preview(&thesis.join("chapters"))
            .unwrap()
            .project_id
            .as_deref(),
        Some(reply.project_id.as_str())
    );
    assert_eq!(crate::linked_registry::list().unwrap().len(), 1);
    let Ok(home) = crate::paths::home_dir() else {
        return;
    };
    assert!(matches!(
        preview(&home),
        Err(Refusal {
            error: OpenFolderError::TooBroad { .. },
            browse: Some(_),
        })
    ));
}

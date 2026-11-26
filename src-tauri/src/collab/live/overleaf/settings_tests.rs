use std::time::Duration;

use oleafly_online::realtime::SpellLanguage;
use oleafly_online::test_support::mock_overleaf::{MockProject, MockUser, Privilege};
use serde_json::{json, Value};

use super::notices::{NotSent, OverleafNotice, Setting};
use super::rig::{eventually, run, FirstStart, OverleafRig, Place};
use super::settings::{
    decide, follow_settings, local_pack, may_be_root, overleaf_compiler, overleaf_language, Base,
    Sides, Step,
};
use crate::collab::testing::TempLibrary;

const MAIN: &str = "main.tex";
const INTRO: &str = "intro.tex";
const REFS: &str = "refs.bib";

fn sides(main: &str, compiler: &str, spelling: Option<&str>) -> Sides {
    Sides {
        main_doc: Some(main.to_owned()),
        compiler: Some(compiler.to_owned()),
        spelling: spelling.map(str::to_owned),
    }
}

fn wire_of(setting: Setting) -> impl Fn(&Option<String>) -> Option<String> {
    move |local: &Option<String>| {
        let local = local.as_deref()?;
        match setting {
            Setting::MainDoc => may_be_root(local).then(|| format!("id:{local}")),
            Setting::Compiler => overleaf_compiler(local),
            _ => Some(local.to_owned()),
        }
    }
}

#[test]
fn the_three_way_check_pushes_follows_or_keeps_overleaf() {
    let base = Base {
        local: sides(MAIN, "latexmk:pdflatex", Some("en")),
        remote: sides(MAIN, "latex", Some("en")),
    };
    let same = base.clone();
    for setting in [Setting::MainDoc, Setting::Compiler, Setting::Spelling] {
        assert_eq!(
            decide(setting, &same, &same.local, &same.remote, wire_of(setting)),
            None
        );
    }
    let moved_here = sides(INTRO, "latexmk:pdflatex", Some("en"));
    assert_eq!(
        decide(
            Setting::MainDoc,
            &base,
            &moved_here,
            &base.remote,
            wire_of(Setting::MainDoc)
        ),
        Some(Step::Push {
            value: "id:intro.tex".into(),
            expected: Some(INTRO.into()),
        })
    );
    assert_eq!(
        decide(
            Setting::Compiler,
            &base,
            &moved_here,
            &base.remote,
            wire_of(Setting::Compiler)
        ),
        None,
        "an Overleaf-only compiler is never corrected when only the main doc moved"
    );
    let moved_there = sides(INTRO, "latex", Some("en"));
    assert_eq!(
        decide(
            Setting::MainDoc,
            &base,
            &base.local,
            &moved_there,
            wire_of(Setting::MainDoc)
        ),
        Some(Step::Follow)
    );
    assert_eq!(
        decide(
            Setting::MainDoc,
            &base,
            &moved_here,
            &moved_there,
            wire_of(Setting::MainDoc)
        ),
        Some(Step::Agree)
    );
    let elsewhere = sides("other.tex", "latex", Some("en"));
    assert_eq!(
        decide(
            Setting::MainDoc,
            &base,
            &moved_here,
            &elsewhere,
            wire_of(Setting::MainDoc)
        ),
        Some(Step::Conflict)
    );
    let tectonic = sides(MAIN, "tectonic:", Some("en"));
    assert_eq!(
        decide(
            Setting::Compiler,
            &base,
            &tectonic,
            &base.remote,
            wire_of(Setting::Compiler)
        ),
        Some(Step::NoEquivalent)
    );
    let xelatex = sides(MAIN, "latexmk:xelatex", Some("en"));
    assert_eq!(
        decide(
            Setting::Compiler,
            &base,
            &xelatex,
            &base.remote,
            wire_of(Setting::Compiler)
        ),
        Some(Step::Push {
            value: "xelatex".into(),
            expected: Some("xelatex".into()),
        })
    );
}

#[test]
fn engines_without_an_overleaf_compiler_have_no_equivalent() {
    for (local, wire) in [
        ("latexmk:pdflatex", Some("pdflatex")),
        ("latexmk:xelatex", Some("xelatex")),
        ("latexmk:lualatex", Some("lualatex")),
        ("latexmk:", None),
        ("latexmk:uplatex", None),
        ("latexmk:platex", None),
        ("tectonic:", None),
        ("typst:", None),
        ("pandoc:", None),
    ] {
        assert_eq!(overleaf_compiler(local).as_deref(), wire, "{local}");
    }
    assert!(may_be_root("paper.TEX") && may_be_root("notes.Rnw") && may_be_root("a.ltx"));
    assert!(!may_be_root("refs.bib") && !may_be_root("README"));
}

#[test]
fn spelling_maps_both_ways() {
    let languages: Vec<SpellLanguage> = ["en", "en_US", "en_GB", "de", "pt_BR", "no"]
        .into_iter()
        .map(|code| SpellLanguage {
            code: code.into(),
            name: code.into(),
        })
        .collect();
    for (local, wire) in [
        ("en_US", Some("en_US")),
        ("pt_BR", Some("pt_BR")),
        ("de_DE", Some("de")),
        ("de_AT", Some("de")),
        ("nb_NO", Some("no")),
        ("fi_FI", None),
    ] {
        assert_eq!(
            overleaf_language(local, &languages).as_deref(),
            wire,
            "{local}"
        );
    }
    let packs: Vec<String> = [
        "de_AT", "de_DE", "en_GB", "en_US", "nb_NO", "pt_PT", "pt_BR",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    for (code, pack) in [
        ("en_US", Some("en_US")),
        ("de", Some("de_DE")),
        ("no", Some("nb_NO")),
        ("pt_BR", Some("pt_BR")),
        ("pt", Some("pt_PT")),
        ("ar", None),
    ] {
        assert_eq!(local_pack(code, &packs).as_deref(), pack, "{code}");
    }
}

fn project() -> MockProject {
    MockProject::new("settings")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .doc(MAIN, "\\documentclass{article}\n")
        .doc(INTRO, "\\section{Intro}\n")
        .doc(REFS, "@book{a}\n")
}

const DISK: &[(&str, &str)] = &[
    (MAIN, "\\documentclass{article}\n"),
    (INTRO, "\\section{Intro}\n"),
    (REFS, "@book{a}\n"),
];

fn settings_posts(rig: &OverleafRig) -> Vec<Value> {
    rig.mock
        .requests(&format!("/project/{}/settings", rig.mock.project_id()))
        .into_iter()
        .filter(|request| request.method == "POST")
        .map(|request| serde_json::from_str(&request.body).unwrap())
        .collect()
}

async fn agreed(rig: &OverleafRig) {
    let base = rig.live.hold_dir().join("settings-base.json");
    eventually("the first agreement is saved", || base.is_file()).await;
}

fn change_meta(project_id: &str, change: impl FnOnce(&mut crate::project::ProjectMeta)) {
    let mut meta = crate::project::read_meta(project_id).unwrap();
    change(&mut meta);
    crate::project::write_meta(project_id, &meta).unwrap();
    crate::collab::settings::local_changed(project_id);
}

#[test]
fn a_local_main_doc_change_reaches_overleaf_and_a_stale_echo_is_ignored() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(project(), DISK, Place::Library).await;
        agreed(&rig).await;
        let project_id = rig.project_id.clone();
        let meta = || crate::project::read_meta(&project_id).unwrap();
        rig.mock.hold_room_events();
        change_meta(&project_id, |meta| meta.main_doc = INTRO.into());
        eventually("the main document is sent", || {
            settings_posts(&rig).len() == 1
        })
        .await;
        change_meta(&project_id, |meta| meta.main_doc = MAIN.into());
        eventually("the second change is sent", || {
            settings_posts(&rig).len() == 2
        })
        .await;
        assert_eq!(
            settings_posts(&rig)[0],
            json!({ "rootDocId": rig.doc(INTRO) })
        );
        assert_eq!(
            settings_posts(&rig)[1],
            json!({ "rootDocId": rig.doc(MAIN) })
        );
        rig.mock.release_first_room_event();
        tokio::time::sleep(Duration::from_millis(800)).await;
        assert_eq!(
            meta().main_doc,
            MAIN,
            "the late echo of the first change did not win"
        );
        rig.mock.release_room_events();
        let later =
            rig.mock
                .peer("bob")
                .rest("POST", "/settings", Some(json!({ "compiler": "lualatex" })));
        assert_eq!(later.status, 204);
        eventually("a change made after the echoes arrives", || {
            meta().tex_flavor.as_deref() == Some("lualatex")
        })
        .await;
        assert_eq!(meta().main_doc, MAIN);
        assert_eq!(settings_posts(&rig).len(), 2, "echoes send nothing back");
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn a_compiler_with_no_overleaf_equivalent_sends_nothing_and_says_so() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(project(), DISK, Place::Library).await;
        agreed(&rig).await;
        let project_id = rig.project_id.clone();
        change_meta(&project_id, |meta| {
            meta.engine = "latexmk".into();
            meta.tex_flavor = Some("uplatex".into());
        });
        eventually("the notice is shown", || {
            rig.host.notices.lock().unwrap().iter().any(|notice| {
                notice.notice
                    == OverleafNotice::SettingNotSent {
                        setting: Setting::Compiler,
                        reason: NotSent::NoEquivalent,
                    }
            })
        })
        .await;
        assert!(settings_posts(&rig).is_empty());
        change_meta(&project_id, |meta| {
            meta.tex_flavor = Some("lualatex".into())
        });
        eventually("lualatex is sent", || {
            settings_posts(&rig) == vec![json!({ "compiler": "lualatex" })]
        })
        .await;
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn a_change_made_while_paused_is_sent_on_the_next_start() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(project(), DISK, Place::Library).await;
        agreed(&rig).await;
        rig.live.mirror.settings.close();
        let project_id = rig.project_id.clone();
        let mut meta = crate::project::read_meta(&project_id).unwrap();
        meta.main_doc = INTRO.into();
        crate::project::write_meta(&project_id, &meta).unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(
            settings_posts(&rig).is_empty(),
            "nothing is sent while the sync is off"
        );
        rig.live.mirror.settings.start(&rig.live.mirror);
        eventually("the change is sent on the next start", || {
            settings_posts(&rig) == vec![json!({ "rootDocId": rig.doc(INTRO) })]
        })
        .await;
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn following_spelling_or_the_main_document_keeps_the_engine() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(project(), DISK, Place::Library).await;
        agreed(&rig).await;
        let project_id = rig.project_id.clone();
        change_meta(&project_id, |meta| {
            meta.engine = "xetex".into();
            meta.tex_flavor = None;
        });
        rig.live
            .mirror
            .follow_local(Some(INTRO), None, Some("en_GB"))
            .unwrap();
        let meta = crate::project::read_meta(&project_id).unwrap();
        assert_eq!(meta.main_doc, INTRO);
        assert_eq!(meta.engine, "xetex");
        assert_eq!(meta.dictionary_locale.as_deref(), Some("en_GB"));
        rig.live
            .mirror
            .follow_local(None, Some("lualatex"), None)
            .unwrap();
        let meta = crate::project::read_meta(&project_id).unwrap();
        assert_eq!(meta.engine, "latexmk");
        assert_eq!(meta.tex_flavor.as_deref(), Some("lualatex"));
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn a_main_document_not_on_disk_yet_is_followed_once_it_arrives() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(project(), DISK, Place::Library).await;
        agreed(&rig).await;
        let later = "later.tex";
        let remote = Sides {
            main_doc: Some(later.into()),
            ..Sides::default()
        };
        let before = Base::default();
        let mut base = before.clone();
        base.remote.main_doc = Some(later.into());
        assert!(
            !follow_settings(
                &rig.live.mirror,
                &[Setting::MainDoc],
                &remote,
                &before,
                &mut base
            )
            .await
        );
        assert_eq!(
            base.remote.main_doc, None,
            "not agreed while the file is missing"
        );
        assert_eq!(
            crate::project::read_meta(&rig.project_id).unwrap().main_doc,
            MAIN
        );
        std::fs::write(rig.root.join(later), "\\documentclass{article}\n").unwrap();
        base.remote.main_doc = Some(later.into());
        assert!(
            follow_settings(
                &rig.live.mirror,
                &[Setting::MainDoc],
                &remote,
                &before,
                &mut base
            )
            .await
        );
        assert_eq!(base.remote.main_doc.as_deref(), Some(later));
        assert_eq!(
            crate::project::read_meta(&rig.project_id).unwrap().main_doc,
            later
        );
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn reviewers_and_viewers_cannot_change_shared_settings() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_full(
            project(),
            DISK,
            Place::Library,
            FirstStart {
                imported: DISK,
                ..FirstStart::default()
            },
            "carol",
        )
        .await;
        eventually("the role is known", || {
            rig.live.role_now() == oleafly_collab_protocol::projects::ProjectRole::Reviewer
        })
        .await;
        assert!(crate::collab::settings::refuse_viewer(&rig.project_id).is_err());
        assert!(
            crate::collab::settings::refuse_server_viewer(&rig.project_id).is_ok(),
            "settings that stay on this computer are still theirs"
        );
        let refused = rig
            .live
            .set_overleaf_setting("bibliography", REFS)
            .await
            .unwrap_err();
        assert!(matches!(
            refused,
            oleafly_collab::CollabError::Api { status: 403, .. }
        ));
        assert!(!rig.live.overleaf_settings().can_change);
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn the_on_overleaf_group_sets_the_bibliography_and_tex_live_version() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(project(), DISK, Place::Library).await;
        agreed(&rig).await;
        assert!(crate::collab::settings::refuse_viewer(&rig.project_id).is_ok());
        let listed = rig.live.overleaf_settings();
        assert_eq!(listed.bibliographies, vec![REFS.to_owned()]);
        assert!(listed.images.is_empty(), "CE offers no TeX Live versions");
        assert!(listed.can_change);
        rig.live
            .set_overleaf_setting("bibliography", REFS)
            .await
            .unwrap();
        eventually("the echo lands", || {
            rig.live.overleaf_settings().bibliography.as_deref() == Some(REFS)
        })
        .await;
        assert!(rig
            .live
            .set_overleaf_setting("bibliography", MAIN)
            .await
            .is_err());
        assert!(rig
            .live
            .set_overleaf_setting("image", "texlive-full:2025.1")
            .await
            .is_err());
        rig.finish().await;
    });
    drop(library);
}

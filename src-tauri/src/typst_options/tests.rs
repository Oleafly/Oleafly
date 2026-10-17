use super::*;
use oleafly_core::typst_toolchain::capabilities_for;
use tempfile::TempDir;

fn project_with_fonts() -> (TempDir, PathBuf) {
    let directory = TempDir::new().unwrap();
    let root = directory.path().join("paper");
    std::fs::create_dir_all(root.join("fonts")).unwrap();
    std::fs::create_dir_all(root.join("assets/type")).unwrap();
    let root = root.canonicalize().unwrap();
    (directory, root)
}

fn spec() -> TypstSpec {
    serde_json::from_value(serde_json::json!({
        "font_paths": ["assets/type", "../elsewhere"],
        "system_fonts": false,
        "inputs": {"draft": "true", "lang": "en"},
        "variants": {"final": {"inputs": {"draft": "false"}}}
    }))
    .unwrap()
}

#[test]
fn settings_follow_the_manifest_and_the_chosen_variant() {
    let (_directory, root) = project_with_fonts();
    let settings = TypstCompileSettings::resolve(Some(&spec()), &root, Some("final"), |_| {
        panic!("only reproducible builds read the commit time")
    });
    assert_eq!(
        settings.font_dirs,
        [root.join("fonts"), root.join("assets/type")]
    );
    assert!(settings.ignore_system_fonts);
    assert_eq!(
        settings.inputs,
        [
            ("draft".to_string(), "false".to_string()),
            ("lang".to_string(), "en".to_string())
        ]
    );
    assert_eq!(settings.creation_timestamp, None);
    assert_eq!(settings.source_date_epoch(Some(9)), Some(9));

    let plain = TypstCompileSettings::resolve(None, &root, Some("final"), |_| None);
    assert_eq!(plain.font_dirs, [root.join("fonts")]);
    assert!(!plain.ignore_system_fonts);
    assert!(plain.inputs.is_empty());
}

#[test]
fn reproducible_builds_pin_the_timestamp_and_drop_system_fonts() {
    let (_directory, root) = project_with_fonts();
    let reproducible = TypstSpec {
        reproducible: true,
        ..TypstSpec::default()
    };
    let committed =
        TypstCompileSettings::resolve(Some(&reproducible), &root, None, |_| Some(1_700_000_000));
    assert_eq!(committed.creation_timestamp, Some(1_700_000_000));
    assert!(committed.ignore_system_fonts);
    assert_eq!(committed.source_date_epoch(Some(5)), Some(1_700_000_000));
    let uncommitted = TypstCompileSettings::resolve(Some(&reproducible), &root, None, |_| None);
    assert_eq!(uncommitted.creation_timestamp, Some(0));
}

#[test]
fn compile_flags_skip_what_the_version_cannot_take() {
    let settings = TypstCompileSettings {
        font_dirs: vec![PathBuf::from("/p/fonts")],
        ignore_system_fonts: true,
        inputs: vec![("draft".into(), "true".into())],
        creation_timestamp: Some(0),
    };
    assert_eq!(
        settings.compile_flags(capabilities_for("0.11.1")),
        [
            TypstCompileFlag::FontPath(PathBuf::from("/p/fonts")),
            TypstCompileFlag::Input {
                key: "draft".into(),
                value: "true".into()
            },
        ]
    );
    assert_eq!(
        settings.compile_flags(capabilities_for("0.15.1")),
        [
            TypstCompileFlag::FontPath(PathBuf::from("/p/fonts")),
            TypstCompileFlag::IgnoreSystemFonts,
            TypstCompileFlag::Input {
                key: "draft".into(),
                value: "true".into()
            },
            TypstCompileFlag::CreationTimestamp(0),
        ]
    );
}

#[test]
fn updates_touch_only_the_fields_they_name() {
    let mut spec: TypstSpec = serde_json::from_value(serde_json::json!({
        "version": "0.15.1",
        "vendor_packages": true,
        "inputs": {"lang": "en"},
        "variants": {"final": {"inputs": {"draft": "false"}, "future": 1}},
        "future_field": {"kept": true}
    }))
    .unwrap();
    TypstOptionsUpdate {
        system_fonts: Some(false),
        ..TypstOptionsUpdate::default()
    }
    .apply(&mut spec)
    .unwrap();
    assert!(!spec.system_fonts);
    assert_eq!(spec.version.as_deref(), Some("0.15.1"));
    assert!(spec.vendor_packages);
    assert_eq!(spec.inputs["lang"], "en");
    assert_eq!(
        spec.extra["future_field"],
        serde_json::json!({"kept": true})
    );

    TypstOptionsUpdate {
        variants: Some(BTreeMap::from([
            (
                " final ".to_string(),
                BTreeMap::from([(" draft ".to_string(), "no".to_string())]),
            ),
            ("review".to_string(), BTreeMap::new()),
        ])),
        reproducible: Some(true),
        font_paths: Some(vec!["fonts/extra".into(), "fonts\\extra".into()]),
        ..TypstOptionsUpdate::default()
    }
    .apply(&mut spec)
    .unwrap();
    assert!(spec.reproducible);
    assert_eq!(spec.font_paths, ["fonts/extra"]);
    assert_eq!(
        spec.variants.keys().collect::<Vec<_>>(),
        ["final", "review"]
    );
    assert_eq!(spec.variants["final"].inputs["draft"], "no");
    assert_eq!(spec.variants["final"].extra["future"], 1);
    assert_eq!(spec.inputs["lang"], "en");
}

#[test]
fn invalid_updates_are_refused_whole() {
    let original = spec();
    for update in [
        TypstOptionsUpdate {
            inputs: Some(BTreeMap::from([("a=b".to_string(), "x".to_string())])),
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            inputs: Some(BTreeMap::from([(" ".to_string(), "x".to_string())])),
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            variants: Some(BTreeMap::from([("  ".to_string(), BTreeMap::new())])),
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            variants: Some(BTreeMap::from([
                ("a".to_string(), BTreeMap::new()),
                ("a ".to_string(), BTreeMap::new()),
            ])),
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            font_paths: Some(vec!["../outside".into()]),
            ..TypstOptionsUpdate::default()
        },
        TypstOptionsUpdate {
            font_paths: Some(vec!["/abs/fonts".into()]),
            ..TypstOptionsUpdate::default()
        },
    ] {
        let mut spec = original.clone();
        let error = update.clone().apply(&mut spec).unwrap_err();
        assert!(error.contains("typst_options."), "{update:?}: {error}");
    }
}

#[test]
fn update_requests_read_camel_case() {
    let update: TypstOptionsUpdate = serde_json::from_value(serde_json::json!({
        "systemFonts": false,
        "variants": {"review": {"anonymous": "true"}}
    }))
    .unwrap();
    assert_eq!(update.system_fonts, Some(false));
    assert_eq!(update.reproducible, None);
    assert_eq!(update.variants.unwrap()["review"]["anonymous"], "true");
}

#[test]
fn the_descriptor_reports_options_and_version_capabilities() {
    let (_directory, root) = project_with_fonts();
    let described = options_descriptor(Some(&spec()), Some(&root), capabilities_for("0.13.1"), &[]);
    assert!(!described.system_fonts);
    assert!(!described.reproducible);
    assert_eq!(described.variants, ["final"]);
    assert_eq!(described.font_dirs.len(), 2);
    assert!(described.output_formats.contains(&"html".to_string()));
    assert!(!described.flags.contains(&"--deps".to_string()));
    assert_eq!(described.pdf_standards, ["1.7", "a-2b", "a-3b"]);
    let json = serde_json::to_value(&described).unwrap();
    assert_eq!(json["system_fonts"], false);
    assert!(json.get("pdf_standards").is_some());
    let unset = options_descriptor(None, None, capabilities_for("0.11.1"), &[]);
    assert!(unset.system_fonts);
    assert!(unset.font_dirs.is_empty());
}

#[test]
fn font_sources_are_sorted_into_project_system_and_embedded() {
    let (_directory, root) = project_with_fonts();
    std::fs::write(root.join("fonts/Inter.otf"), b"font").unwrap();
    let families = vec![
        TypstFontFamily {
            name: "Inter".into(),
            sources: vec![
                root.join("fonts/Inter.otf").to_string_lossy().into_owned(),
                "/System/Library/Fonts/Inter.ttc".into(),
            ],
        },
        TypstFontFamily {
            name: "Libertinus Serif".into(),
            sources: vec!["(Embedded)".into()],
        },
        TypstFontFamily {
            name: "Plain".into(),
            sources: Vec::new(),
        },
    ];
    let entries = font_entries(families, &root, &[root.join("fonts")], None);
    assert_eq!(
        entries[0].sources,
        [
            TypstFontSource {
                kind: "project",
                path: Some("fonts/Inter.otf".into())
            },
            TypstFontSource {
                kind: "system",
                path: Some("/System/Library/Fonts/Inter.ttc".into())
            },
        ]
    );
    assert_eq!(
        entries[1].sources,
        [TypstFontSource {
            kind: "embedded",
            path: None
        }]
    );
    assert!(entries[2].sources.is_empty());
}

#[test]
fn the_language_server_gets_installed_pack_folders_unless_system_fonts_are_off() {
    let (_directory, root) = project_with_fonts();
    let shared = [PathBuf::from("/packs/typst-text")];
    let open = options_descriptor(None, Some(&root), capabilities_for("0.15.1"), &shared);
    assert!(open.font_dirs.iter().any(|dir| dir.ends_with("typst-text")));
    let sealed = TypstSpec {
        system_fonts: false,
        ..TypstSpec::default()
    };
    let closed = options_descriptor(
        Some(&sealed),
        Some(&root),
        capabilities_for("0.15.1"),
        &shared,
    );
    assert!(closed
        .font_dirs
        .iter()
        .all(|dir| !dir.ends_with("typst-text")));
}

#[test]
fn fonts_from_installed_packs_are_listed_by_pack() {
    let (_directory, root) = project_with_fonts();
    let packs = tempfile::tempdir().unwrap();
    let pack = packs.path().join("typst-text");
    std::fs::create_dir_all(&pack).unwrap();
    std::fs::write(pack.join("LiberationSans-Regular.ttf"), b"font").unwrap();
    let families = vec![TypstFontFamily {
        name: "Liberation Sans".into(),
        sources: vec![pack
            .join("LiberationSans-Regular.ttf")
            .to_string_lossy()
            .into_owned()],
    }];
    let entries = font_entries(
        families,
        &root,
        &[root.join("fonts"), pack.clone()],
        Some(&packs.path().canonicalize().unwrap()),
    );
    assert_eq!(
        entries[0].sources,
        [TypstFontSource {
            kind: "pack",
            path: Some("typst-text".into())
        }]
    );
}

#[test]
fn shared_pack_folders_join_compiles_unless_system_fonts_are_off() {
    let (_directory, root) = project_with_fonts();
    let shared = vec![
        PathBuf::from("/packs/typst-cjk"),
        PathBuf::from("/packs/typst-text"),
    ];
    let open = TypstCompileSettings::resolve(None, &root, None, |_| None)
        .with_shared_font_dirs(shared.clone());
    assert!(open.font_dirs.ends_with(&shared));
    let sealed = TypstSpec {
        system_fonts: false,
        ..TypstSpec::default()
    };
    let closed = TypstCompileSettings::resolve(Some(&sealed), &root, None, |_| None)
        .with_shared_font_dirs(shared.clone());
    assert!(closed.font_dirs.iter().all(|dir| !shared.contains(dir)));
    let twice = open.with_shared_font_dirs(shared.clone());
    assert_eq!(
        twice
            .font_dirs
            .iter()
            .filter(|dir| shared.contains(dir))
            .count(),
        shared.len()
    );
}

#[test]
fn recorded_dependencies_stay_inside_the_project() {
    let (_directory, root) = project_with_fonts();
    let build = root.join(".oleafly/build");
    std::fs::create_dir_all(&build).unwrap();
    std::fs::write(
        dependency_file(&build),
        r#"{"inputs":["main.typ","build/figure.svg","../outside.typ","/usr/share/fonts/x.otf"],"outputs":[]}"#,
    )
    .unwrap();
    let inputs = recorded_dependencies(&build, &root);
    assert_eq!(
        inputs.into_iter().collect::<Vec<_>>(),
        ["build/figure.svg", "main.typ"]
    );
    assert!(recorded_dependencies(&root.join("missing"), &root).is_empty());
}

#[cfg(unix)]
#[test]
fn the_bundled_typst_lists_fonts_from_the_project_folder() {
    let Some(typst) = bundled_typst() else {
        return;
    };
    let (_directory, root) = project_with_fonts();
    let version = oleafly_core::typst_toolchain::bundled_typst_version();
    let arguments = oleafly_core::typst_toolchain::typst_fonts_args(
        capabilities_for(&version.to_string()),
        version,
        &[root.join("fonts")],
        true,
    );
    let mut command = std::process::Command::new(&typst);
    command.no_console().args(arguments).current_dir(&root);
    let output = crate::proc::output_contained_with_timeout(command, FONT_LIST_TIMEOUT).unwrap();
    assert!(output.status.success());
    let families =
        oleafly_core::typst_toolchain::parse_typst_fonts(&String::from_utf8_lossy(&output.stdout));
    let embedded = families
        .iter()
        .find(|family| family.name == "New Computer Modern")
        .expect("Typst embeds New Computer Modern");
    assert_eq!(
        embedded.sources.first().map(String::as_str),
        Some(EMBEDDED_FONT)
    );
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
pub(crate) fn bundled_typst() -> Option<PathBuf> {
    let triple = crate::biber_toolchain::host_triple_guess()?;
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
    path.is_file().then_some(path)
}

#[test]
fn existing_setters_keep_new_and_unknown_typst_fields() {
    let mut meta = ProjectMeta {
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        typst: Some(
            serde_json::from_value(serde_json::json!({
                "vendor_packages": true,
                "reproducible": true,
                "future": [1]
            }))
            .unwrap(),
        ),
        ..ProjectMeta::default()
    };
    crate::typst_packages::set_vendor_flag(&mut meta, false);
    meta.set_typst_version_pin(None);
    let spec = meta.typst.clone().expect("the spec still holds options");
    assert!(spec.reproducible);
    assert_eq!(spec.extra["future"], serde_json::json!([1]));
    let mut bare = ProjectMeta {
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        typst: Some(TypstSpec {
            vendor_packages: true,
            ..TypstSpec::default()
        }),
        ..ProjectMeta::default()
    };
    crate::typst_packages::set_vendor_flag(&mut bare, false);
    assert!(bare.typst.is_none());
}

#[test]
fn font_listing_reads_typst_options_only_for_typst_projects() {
    let (_directory, root) = project_with_fonts();
    let latex = ProjectMeta {
        main_doc: "main.tex".into(),
        engine: "xetex".into(),
        typst: Some(spec()),
        ..ProjectMeta::default()
    };
    let settings = font_list_settings(&latex, &root);
    assert_eq!(settings.font_dirs, [root.join("fonts")]);
    assert!(!settings.ignore_system_fonts);
    let markdown = ProjectMeta {
        main_doc: "main.md".into(),
        engine: "markdown".into(),
        ..ProjectMeta::default()
    };
    assert_eq!(
        font_list_settings(&markdown, &root).font_dirs,
        [root.join("fonts")]
    );
    let typst = ProjectMeta {
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        typst: Some(spec()),
        ..ProjectMeta::default()
    };
    let settings = font_list_settings(&typst, &root);
    assert!(settings.ignore_system_fonts);
    assert_eq!(
        settings.font_dirs,
        [root.join("fonts"), root.join("assets/type")]
    );
}

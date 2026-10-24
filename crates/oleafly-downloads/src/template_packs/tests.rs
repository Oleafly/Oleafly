use super::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const BASE: &str = "https://raw.githubusercontent.com/Oleafly/template-packs/main";
const MIRROR: &str = "https://mirrors.oleafly.com/template-files";

fn file(name: &str) -> PackFile {
    PackFile {
        name: name.into(),
        url: format!("{BASE}/packs/p/{name}"),
        sha256: None,
    }
}

fn v1_pack(files: Vec<PackFile>) -> TemplatePack {
    TemplatePack {
        id: "venue-classes".into(),
        label: "Venue classes".into(),
        description: String::new(),
        category: "Journals & Conferences".into(),
        approx_bytes: 10,
        count: 0,
        license_summary: "CC0-1.0".into(),
        files,
    }
}

fn index_json(templates: serde_json::Value) -> String {
    serde_json::json!({ "version": 2, "id": "open-letter", "templates": templates }).to_string()
}

fn index_entry(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": format!("{id} name"),
        "description": "A letter",
        "category": "Business",
        "engine": "pdflatex",
        "main_doc": "main.tex",
        "license": { "spdx": "MIT", "label": "MIT" },
        "bytes": 42,
        "files": [
            { "name": format!("{id}/main.tex"), "url": format!("{BASE}/packs/open-letter/{id}/main.tex") },
            { "name": format!("{id}/template.json"), "url": format!("{BASE}/packs/open-letter/{id}/template.json") }
        ]
    })
}

fn catalog_v2_json(packs: serde_json::Value) -> String {
    serde_json::json!({ "version": 2, "packs": packs }).to_string()
}

fn catalog_v2_entry(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "label": "Open letter templates",
        "description": "Letters",
        "category": "Business",
        "group": "community",
        "count": 31,
        "bytes": 104627,
        "license_summary": "MIT",
        "index_url": format!("{BASE}/indexes/{id}.json"),
        "covers": [format!("{BASE}/previews/{id}/a/thumb.webp")]
    })
}

#[test]
fn v1_catalog_parses_and_ids_are_safe() {
    let json = format!(
        r#"[{{"id":"venue-classes","label":"Venue classes","count":2,
            "files":[{{"name":"a/template.json","url":"{BASE}/a/template.json"}}]}}]"#
    );
    let packs = parse_catalog(&json, BASE).unwrap();
    assert_eq!(packs[0].id, "venue-classes");
    assert!(is_valid_id(&packs[0].id));
    assert!(is_safe_rel_file(&packs[0].files[0].name));
}

#[test]
fn v1_catalog_rejects_bad_ids_names_and_foreign_urls() {
    let bad_id = r#"[{"id":"../x","label":"","files":[]}]"#;
    assert!(parse_catalog(bad_id, BASE).is_err());
    let bad_file =
        format!(r#"[{{"id":"ok","label":"","files":[{{"name":"../evil","url":"{BASE}/x"}}]}}]"#);
    assert!(parse_catalog(&bad_file, BASE).is_err());
    let foreign = r#"[{"id":"ok","label":"","files":[{"name":"a/b.tex","url":"https://evil.example/b.tex"}]}]"#;
    assert!(parse_catalog(foreign, BASE).is_err());
}

#[test]
fn file_names_may_nest_but_never_escape() {
    assert!(is_safe_rel_file("sn-jnl-article/main.tex"));
    assert!(is_safe_rel_file("gh-a-thesis/fonts/Junicode.ttf"));
    assert!(is_safe_rel_file("tpl/assets/fig 1.png"));
    assert!(is_safe_rel_file("tpl/图片/清华.png"));
    assert!(!is_safe_rel_file("../evil.tex"));
    assert!(!is_safe_rel_file("tpl/../../evil.tex"));
    assert!(!is_safe_rel_file("tpl/./main.tex"));
    assert!(!is_safe_rel_file("/abs.tex"));
    assert!(!is_safe_rel_file("a\\b.tex"));
    assert!(!is_safe_rel_file("a//b.tex"));
    assert!(!is_safe_rel_file("tpl/"));
    assert!(!is_safe_rel_file("C:/evil.tex"));
    assert!(!is_safe_rel_file(""));
}

#[test]
fn only_the_pack_repository_or_the_configured_base_is_allowed() {
    assert!(url_allowed(&format!("{BASE}/catalog-v2.json"), BASE));
    assert!(url_allowed(
        "https://raw.githubusercontent.com/Oleafly/template-packs/v2/indexes/a.json",
        "http://127.0.0.1:38999"
    ));
    assert!(url_allowed(
        "http://127.0.0.1:38999/indexes/a.json",
        "http://127.0.0.1:38999"
    ));
    assert!(!url_allowed(
        "http://127.0.0.1:389990/indexes/a.json",
        "http://127.0.0.1:38999"
    ));
    assert!(!url_allowed(
        "http://127.0.0.2:38999/a.json",
        "http://127.0.0.1:38999"
    ));
    assert!(!url_allowed("https://evil.example/a.json", BASE));
    assert!(!url_allowed(
        "https://raw.githubusercontent.com/Other/repo/main/a.json",
        BASE
    ));
    assert!(!url_allowed(
        "https://raw.githubusercontent.com/Oleafly/template-packs/../evil/main/a.json",
        BASE
    ));
    assert!(!url_allowed(
        "https://raw.githubusercontent.com/Oleafly/template-packs/%2e%2e/evil/a.json",
        BASE
    ));
    assert!(!url_allowed(
        "http://raw.githubusercontent.com/Oleafly/template-packs/main/a.json",
        BASE
    ));
    assert!(!url_allowed(
        "https://user@raw.githubusercontent.com/Oleafly/template-packs/main/a.json",
        BASE
    ));
    assert!(!url_allowed("file:///etc/passwd", BASE));
    assert!(!url_allowed("not a url", BASE));
}

#[test]
fn template_files_may_come_from_the_oleafly_file_mirror_only() {
    let sha = "a".repeat(64);
    assert!(file_url_allowed(&format!("{MIRROR}/{sha}.ttf"), BASE));
    assert!(file_url_allowed(&format!("{MIRROR}/{sha}.png"), BASE));
    assert!(!url_allowed(&format!("{MIRROR}/{sha}.png"), BASE));
    assert!(!file_url_allowed(
        "https://mirrors.oleafly.com/template-fonts/a.ttf",
        BASE
    ));
    assert!(!file_url_allowed(
        "https://mirrors.oleafly.com/other/a.ttf",
        BASE
    ));
    assert!(!file_url_allowed(
        "http://mirrors.oleafly.com/template-files/a.ttf",
        BASE
    ));
    assert!(!file_url_allowed(
        "https://mirrors.oleafly.com/template-files/../other/a.ttf",
        BASE
    ));
    assert!(!file_url_allowed(
        "https://mirrors.oleafly.com.evil.example/template-files/a.ttf",
        BASE
    ));
}

#[test]
fn catalog_v2_parses_groups_and_caps_covers() {
    let mut entry = catalog_v2_entry("open-letter");
    entry["covers"] = serde_json::json!((0..6)
        .map(|i| format!("{BASE}/previews/open-letter/t{i}/thumb.webp"))
        .collect::<Vec<_>>());
    let mut odd = catalog_v2_entry("odd-group");
    odd["group"] = serde_json::json!("experimental");
    let mut uni = catalog_v2_entry("cn-universities");
    uni["group"] = serde_json::json!("university");
    let packs =
        parse_catalog_v2(&catalog_v2_json(serde_json::json!([entry, odd, uni])), BASE).unwrap();
    assert_eq!(packs.len(), 3);
    assert_eq!(packs[0].covers.len(), 4);
    assert_eq!(packs[0].group, "community");
    assert_eq!(packs[1].group, "community");
    assert_eq!(packs[2].group, "university");
    assert_eq!(
        packs[0].source,
        PackSource::Index(format!("{BASE}/indexes/open-letter.json"))
    );
}

#[test]
fn catalog_v2_rejects_bad_ids_foreign_urls_and_other_versions() {
    let bad_id = catalog_v2_json(serde_json::json!([catalog_v2_entry("../evil")]));
    assert!(parse_catalog_v2(&bad_id, BASE).is_err());
    let mut foreign_index = catalog_v2_entry("open-letter");
    foreign_index["index_url"] = serde_json::json!("https://evil.example/index.json");
    assert!(parse_catalog_v2(&catalog_v2_json(serde_json::json!([foreign_index])), BASE).is_err());
    let mut foreign_cover = catalog_v2_entry("open-letter");
    foreign_cover["covers"] = serde_json::json!(["https://evil.example/c.webp"]);
    assert!(parse_catalog_v2(&catalog_v2_json(serde_json::json!([foreign_cover])), BASE).is_err());
    let duplicate = catalog_v2_json(serde_json::json!([
        catalog_v2_entry("open-letter"),
        catalog_v2_entry("open-letter")
    ]));
    assert!(parse_catalog_v2(&duplicate, BASE).is_err());
    let v3 = serde_json::json!({ "version": 3, "packs": [] }).to_string();
    assert!(parse_catalog_v2(&v3, BASE).is_err());
}

#[test]
fn index_returns_slim_templates_with_optional_fields() {
    let mut rich = index_entry("tsinghua-thesis");
    rich["license"] =
        serde_json::json!({ "spdx": null, "label": "Unlicensed (no license stated)" });
    rich["credit"] = serde_json::json!({ "url": "https://github.com/owner/repo", "author": null });
    rich["thumb_url"] = serde_json::json!(format!(
        "{BASE}/previews/open-letter/tsinghua-thesis/thumb.webp"
    ));
    rich["preview_url"] = serde_json::json!(format!(
        "{BASE}/previews/open-letter/tsinghua-thesis/page-1.webp"
    ));
    rich["kind"] = serde_json::json!("thesis");
    rich["languages"] = serde_json::json!(["zh", "en"]);
    rich["country"] = serde_json::json!("CN");
    rich["institution"] = serde_json::json!("Tsinghua University");
    rich["tex_flavor"] = serde_json::json!(null);
    rich["files"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": "tsinghua-thesis/assets/fig 1.png",
            "url": format!("{BASE}/packs/open-letter/tsinghua-thesis/assets/fig%201.png")
        }));
    let mut plain = index_entry("plain-letter");
    plain["languages"] = serde_json::json!("de");
    plain["credit"] = serde_json::json!({ "url": "javascript:alert(1)" });
    let templates = parse_index(
        &index_json(serde_json::json!([rich, plain])),
        "open-letter",
        BASE,
    )
    .unwrap();
    assert_eq!(templates.len(), 2);
    let info = &templates[0].info;
    assert_eq!(info.id, "tsinghua-thesis");
    assert_eq!(info.license.spdx, None);
    assert_eq!(info.license.label, "Unlicensed (no license stated)");
    assert_eq!(
        info.credit,
        Some(PackTemplateCredit {
            url: "https://github.com/owner/repo".into(),
            author: None
        })
    );
    assert_eq!(info.kind.as_deref(), Some("thesis"));
    assert_eq!(info.languages, vec!["zh", "en"]);
    assert_eq!(info.country.as_deref(), Some("CN"));
    assert_eq!(info.institution.as_deref(), Some("Tsinghua University"));
    assert_eq!(info.file_count, 3);
    assert!(info
        .preview_url
        .as_deref()
        .unwrap()
        .ends_with("page-1.webp"));
    assert!(!info.installed);
    let plain = &templates[1].info;
    assert_eq!(plain.languages, vec!["de"]);
    assert_eq!(plain.credit, None);
    assert_eq!(plain.license.spdx.as_deref(), Some("MIT"));
    let slim = serde_json::to_value(info).unwrap();
    assert!(slim.get("files").is_none());
    assert!(!slim.to_string().contains("/packs/open-letter/"));
}

#[test]
fn index_accepts_mirror_files_and_keeps_their_checksums() {
    let sha = "b".repeat(64);
    let mut entry = index_entry("gh-a-thesis");
    entry["files"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": "gh-a-thesis/fonts/Junicode.ttf",
            "url": format!("{MIRROR}/{sha}.ttf"),
            "sha256": sha
        }));
    let templates =
        parse_index(&index_json(serde_json::json!([entry])), "open-letter", BASE).unwrap();
    let font = templates[0]
        .files
        .iter()
        .find(|f| f.name.ends_with("Junicode.ttf"))
        .unwrap();
    assert_eq!(font.sha256.as_deref(), Some(sha.as_str()));
    let mut foreign = index_entry("gh-a-thesis");
    foreign["files"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": "gh-a-thesis/fonts/Junicode.ttf",
            "url": "https://mirrors.oleafly.com/template-fonts/x.ttf"
        }));
    assert!(parse_index(
        &index_json(serde_json::json!([foreign])),
        "open-letter",
        BASE
    )
    .is_err());
}

#[test]
fn index_rejects_unsafe_entries_and_drops_misfiled_templates() {
    let mut traversal = index_entry("evil");
    traversal["files"] =
        serde_json::json!([{ "name": "evil/../../x.tex", "url": format!("{BASE}/x.tex") }]);
    assert!(parse_index(
        &index_json(serde_json::json!([traversal])),
        "open-letter",
        BASE
    )
    .is_err());
    let mut foreign = index_entry("evil");
    foreign["files"] =
        serde_json::json!([{ "name": "evil/main.tex", "url": "https://evil.example/main.tex" }]);
    assert!(parse_index(
        &index_json(serde_json::json!([foreign])),
        "open-letter",
        BASE
    )
    .is_err());
    let mut thumb = index_entry("evil");
    thumb["thumb_url"] = serde_json::json!("https://evil.example/t.webp");
    assert!(parse_index(&index_json(serde_json::json!([thumb])), "open-letter", BASE).is_err());
    let bad_id = index_entry("../evil");
    assert!(parse_index(
        &index_json(serde_json::json!([bad_id])),
        "open-letter",
        BASE
    )
    .is_err());
    assert!(parse_index(&index_json(serde_json::json!([])), "another-pack", BASE).is_err());
    let mut misfiled = index_entry("first");
    misfiled["files"] =
        serde_json::json!([{ "name": "second/main.tex", "url": format!("{BASE}/m.tex") }]);
    let kept = parse_index(
        &index_json(serde_json::json!([
            misfiled,
            index_entry("second"),
            index_entry("second")
        ])),
        "open-letter",
        BASE,
    )
    .unwrap();
    assert_eq!(
        kept.iter().map(|t| t.info.id.as_str()).collect::<Vec<_>>(),
        vec!["second"]
    );
}

#[test]
fn v1_packs_become_browsable_templates() {
    let pack = from_v1(v1_pack(vec![
        file("dissertation-classic/main.tex"),
        file("dissertation-classic/preview.png"),
        file("dissertation-classic/template.json"),
        file("essay/main.tex"),
        file("essay/template.json"),
    ]));
    assert_eq!(pack.group, "curated");
    assert_eq!(pack.count, 2);
    assert_eq!(
        pack.covers,
        vec![format!("{BASE}/packs/p/dissertation-classic/preview.png")]
    );
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("essay")).unwrap();
    std::fs::write(
        dir.path().join("essay").join("template.json"),
        r#"{"id":"essay","name":"Short essay","engine":"xetex"}"#,
    )
    .unwrap();
    let templates = v1_templates(&pack, Some(dir.path()));
    assert_eq!(templates.len(), 2);
    assert_eq!(templates[0].info.id, "dissertation-classic");
    assert_eq!(templates[0].info.name, "Dissertation Classic");
    assert_eq!(templates[0].info.file_count, 3);
    assert!(templates[0]
        .info
        .thumb_url
        .as_deref()
        .unwrap()
        .ends_with("preview.png"));
    assert_eq!(templates[0].info.license.label, "CC0-1.0");
    assert_eq!(templates[1].info.name, "Short essay");
    assert_eq!(templates[1].info.engine, "xetex");
    assert_eq!(templates[1].info.thumb_url, None);
    let open = from_v1(TemplatePack {
        id: "open-cv".into(),
        ..v1_pack(vec![])
    });
    assert_eq!(open.group, "community");
}

#[test]
fn installed_state_is_per_template_and_per_pack() {
    let dir = tempfile::tempdir().unwrap();
    let pack = from_v1(v1_pack(vec![
        file("t1/main.tex"),
        file("t1/template.json"),
        file("t2/main.tex"),
        file("t2/template.json"),
    ]));
    std::fs::create_dir_all(dir.path().join("t1")).unwrap();
    std::fs::write(dir.path().join("t1/main.tex"), "x").unwrap();
    std::fs::write(dir.path().join("t1/template.json"), "{}").unwrap();
    std::fs::create_dir_all(dir.path().join("t2")).unwrap();
    std::fs::write(dir.path().join("t2/main.tex"), "x").unwrap();
    let info = pack_info(&pack, dir.path());
    assert_eq!(
        (info.installed, info.installed_count, info.version),
        (false, 1, 1)
    );
    let marked = mark_installed(dir.path(), v1_templates(&pack, None));
    assert_eq!(
        marked.iter().map(|t| t.installed).collect::<Vec<_>>(),
        vec![true, false]
    );
    std::fs::write(dir.path().join("t2/template.json"), "{}").unwrap();
    assert!(pack_info(&pack, dir.path()).installed);

    let v2 = CatalogPack {
        count: 2,
        source: PackSource::Index(format!("{BASE}/indexes/p.json")),
        ..pack
    };
    std::fs::create_dir_all(dir.path().join(".staging")).unwrap();
    std::fs::write(dir.path().join(".staging/template.json"), "{}").unwrap();
    let info = pack_info(&v2, dir.path());
    assert_eq!(
        (info.installed, info.installed_count, info.version),
        (true, 2, 2)
    );
    std::fs::remove_file(dir.path().join("t2/template.json")).unwrap();
    let info = pack_info(&v2, dir.path());
    assert_eq!((info.installed, info.installed_count), (false, 1));
}

#[test]
fn one_template_plans_only_its_own_missing_files_and_preview() {
    let dir = tempfile::tempdir().unwrap();
    let mut templates = parse_index(
        &index_json(serde_json::json!([index_entry("a"), index_entry("b")])),
        "open-letter",
        BASE,
    )
    .unwrap();
    templates[1].info.preview_url = Some(format!("{BASE}/previews/open-letter/b/page-1.webp"));
    std::fs::create_dir_all(dir.path().join("b")).unwrap();
    std::fs::write(dir.path().join("b/main.tex"), "x").unwrap();
    let only_b: Vec<PackTemplate> = templates.into_iter().filter(|t| t.info.id == "b").collect();
    let plan = plan_downloads(dir.path(), only_b.clone(), true);
    assert_eq!((plan.present, plan.total), (1, 2));
    assert_eq!(plan.jobs.len(), 1);
    assert_eq!(plan.jobs[0].id, "b");
    assert_eq!(
        plan.jobs[0]
            .missing
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>(),
        vec!["b/template.json"]
    );
    assert!(plan.jobs[0]
        .preview
        .as_deref()
        .unwrap()
        .ends_with("page-1.webp"));
    assert!(plan_downloads(dir.path(), only_b.clone(), false).jobs[0]
        .preview
        .is_none());
    std::fs::write(dir.path().join("b/template.json"), "{}").unwrap();
    std::fs::write(dir.path().join("b/preview.webp"), "RIFF").unwrap();
    assert!(plan_downloads(dir.path(), only_b, true).jobs.is_empty());
}

#[test]
fn caches_stay_fresh_for_thirty_minutes() {
    let now = SystemTime::now();
    assert!(fresh(now, now));
    assert!(fresh(now - Duration::from_secs(29 * 60), now));
    assert!(!fresh(now - Duration::from_secs(30 * 60), now));
    assert!(!fresh(now - Duration::from_secs(31 * 60), now));
    assert!(!fresh(now + Duration::from_secs(60), now));
    let dir = tempfile::tempdir().unwrap();
    assert!(!catalog_fresh(dir.path(), now));
    std::fs::write(dir.path().join(V1_CACHE), "[]").unwrap();
    assert!(catalog_fresh(dir.path(), SystemTime::now()));
    assert!(!catalog_fresh(
        dir.path(),
        SystemTime::now() + Duration::from_secs(31 * 60)
    ));
}

#[test]
fn a_failed_refresh_waits_a_minute_before_trying_again() {
    let now = Instant::now();
    assert!(retry_due(None, now));
    assert!(!retry_due(Some(now), now + Duration::from_secs(59)));
    assert!(retry_due(Some(now), now + Duration::from_secs(60)));
}

#[test]
fn catalog_prefers_v2_cache_then_v1_cache_then_bundled() {
    let root = tempfile::tempdir().unwrap();
    let bundled = root.path().join("bundled.json");
    std::fs::write(
        &bundled,
        serde_json::to_string(&vec![v1_pack(vec![file("b/main.tex")])]).unwrap(),
    )
    .unwrap();
    let packs = catalog_from(Some(root.path()), Some(&bundled), BASE).unwrap();
    assert_eq!(packs[0].id, "venue-classes");
    assert!(matches!(packs[0].source, PackSource::Files(_)));

    std::fs::write(
        root.path().join(V1_CACHE),
        serde_json::to_string(&vec![TemplatePack {
            id: "cached-v1".into(),
            ..v1_pack(vec![file("c/main.tex")])
        }])
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        catalog_from(Some(root.path()), Some(&bundled), BASE).unwrap()[0].id,
        "cached-v1"
    );

    std::fs::write(
        root.path().join(V2_CACHE),
        "{\"version\":2,\"packs\":[{\"id\":\"../bad\"}]}",
    )
    .unwrap();
    assert_eq!(
        catalog_from(Some(root.path()), Some(&bundled), BASE).unwrap()[0].id,
        "cached-v1"
    );

    std::fs::write(
        root.path().join(V2_CACHE),
        catalog_v2_json(serde_json::json!([catalog_v2_entry("open-letter")])),
    )
    .unwrap();
    let packs = catalog_from(Some(root.path()), Some(&bundled), BASE).unwrap();
    assert_eq!(packs[0].id, "open-letter");
    assert!(matches!(packs[0].source, PackSource::Index(_)));
    assert!(catalog_from(None, None, BASE).unwrap().is_empty());
}

#[test]
fn the_bundled_v1_catalog_is_still_valid_and_browsable() {
    // The app bundles the catalog; this crate reads it from there.
    let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../src-tauri/resources")
        .join("template-packs.json");
    let packs = catalog_from(None, Some(&bundled), DEFAULT_BASE_URL).unwrap();
    assert!(!packs.is_empty());
    for pack in &packs {
        let templates = v1_templates(pack, None);
        assert!(!templates.is_empty(), "{} has no templates", pack.id);
        assert!(templates.iter().all(|t| is_valid_id(&t.info.id)));
    }
}

#[test]
fn pack_install_dir_guards_ids() {
    let root = tempfile::tempdir().unwrap();
    assert!(pack_install_dir_in(root.path(), "../evil").is_err());
    assert_eq!(
        pack_install_dir_in(root.path(), "venue-classes").unwrap(),
        root.path().join("packs").join("venue-classes")
    );
}

static ENV_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn base_url_env_override_wins() {
    let _env_guard = ENV_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    std::env::set_var("OLEAFLY_PACKS_BASE_URL", "http://127.0.0.1:9999/");
    assert_eq!(packs_base_url(), "http://127.0.0.1:9999");
    std::env::remove_var("OLEAFLY_PACKS_BASE_URL");
    assert!(
        packs_base_url().starts_with("https://raw.githubusercontent.com/Oleafly/template-packs/")
    );
}

struct FixtureServer {
    base: String,
    hits: Arc<Mutex<HashMap<String, usize>>>,
}

async fn serve(routes: HashMap<String, (u16, Vec<u8>)>) -> FixtureServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let hits: Arc<Mutex<HashMap<String, usize>>> = Arc::default();
    let routes = Arc::new(routes);
    let counted = hits.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let routes = routes.clone();
            let counted = counted.clone();
            tokio::spawn(async move {
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buffer).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => request.extend_from_slice(&buffer[..n]),
                    }
                }
                let line = String::from_utf8_lossy(&request).to_string();
                let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
                *counted.lock().unwrap().entry(path.clone()).or_default() += 1;
                let (status, body) = routes
                    .get(&path)
                    .cloned()
                    .unwrap_or((404, b"missing".to_vec()));
                let head = format!(
                    "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(&body).await;
            });
        }
    });
    FixtureServer { base, hits }
}

fn test_client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn served(base: &str, name: &str) -> PackFile {
    PackFile {
        name: name.into(),
        url: format!("{base}/files/{}", name.replace(' ', "%20")),
        sha256: None,
    }
}

fn job_template(id: &str, files: Vec<PackFile>, preview: Option<String>) -> PackTemplate {
    PackTemplate {
        info: PackTemplateInfo {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            category: String::new(),
            engine: String::new(),
            license: PackTemplateLicense {
                spdx: None,
                label: String::new(),
            },
            credit: None,
            thumb_url: None,
            preview_url: preview,
            kind: None,
            languages: Vec::new(),
            country: None,
            institution: None,
            bytes: 0,
            file_count: files.len(),
            installed: false,
        },
        files,
    }
}

#[tokio::test]
async fn downloads_nested_files_previews_and_mirror_files_then_resumes() {
    let font = b"font bytes".to_vec();
    let mut routes: HashMap<String, (u16, Vec<u8>)> = HashMap::new();
    for (name, body) in [
        ("a/main.tex", b"main".to_vec()),
        ("a/template.json", b"{}".to_vec()),
        ("a/assets/fig%201.png", b"png".to_vec()),
        ("b/main.tex", b"main b".to_vec()),
        ("b/template.json", b"{}".to_vec()),
    ] {
        routes.insert(format!("/files/{name}"), (200, body));
    }
    routes.insert("/mirror/font.ttf".into(), (200, font.clone()));
    routes.insert("/previews/a.webp".into(), (200, b"RIFF".to_vec()));
    let server = serve(routes).await;
    let base = server.base.clone();
    let mut mirrored = served(&base, "a/fonts/Junicode.ttf");
    mirrored.url = format!("{base}/mirror/font.ttf");
    mirrored.sha256 = Some(sha_hex(&font));
    let templates = vec![
        job_template(
            "a",
            vec![
                served(&base, "a/main.tex"),
                served(&base, "a/assets/fig 1.png"),
                mirrored,
                served(&base, "a/template.json"),
            ],
            Some(format!("{base}/previews/a.webp")),
        ),
        job_template(
            "b",
            vec![
                served(&base, "b/main.tex"),
                served(&base, "b/template.json"),
            ],
            None,
        ),
    ];
    let dir = tempfile::tempdir().unwrap();
    let events = Mutex::new(Vec::new());
    let emit = |progress: DownloadProgress| {
        events.lock().unwrap().push((progress.done, progress.total));
    };
    let plan = plan_downloads(dir.path(), templates.clone(), true);
    download_templates(&test_client(), dir.path(), plan, &emit)
        .await
        .unwrap();
    assert!(dir.path().join("a/assets/fig 1.png").is_file());
    assert_eq!(
        std::fs::read(dir.path().join("a/fonts/Junicode.ttf")).unwrap(),
        font
    );
    assert!(dir.path().join("a/preview.webp").is_file());
    assert!(dir.path().join("b/template.json").is_file());
    assert_eq!(installed_template_count(dir.path()), 2);
    let events = events.into_inner().unwrap();
    assert_eq!(events.last(), Some(&(6, 6)));
    assert!(events.len() <= 6);
    let leftovers: Vec<_> = walk(dir.path())
        .into_iter()
        .filter(|p| p.to_string_lossy().ends_with(".part"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");

    let before = server.hits.lock().unwrap().values().sum::<usize>();
    let plan = plan_downloads(dir.path(), templates, true);
    assert!(plan.jobs.is_empty());
    download_templates(&test_client(), dir.path(), plan, &|_| {})
        .await
        .unwrap();
    assert_eq!(server.hits.lock().unwrap().values().sum::<usize>(), before);
}

#[tokio::test]
async fn a_checksum_mismatch_deletes_the_file_and_keeps_the_template_uninstalled() {
    let mut routes: HashMap<String, (u16, Vec<u8>)> = HashMap::new();
    routes.insert("/files/a/main.tex".into(), (200, b"main".to_vec()));
    routes.insert("/files/a/template.json".into(), (200, b"{}".to_vec()));
    routes.insert("/mirror/big.png".into(), (200, b"tampered".to_vec()));
    let server = serve(routes).await;
    let base = server.base.clone();
    let mut image = served(&base, "a/assets/big.png");
    image.url = format!("{base}/mirror/big.png");
    image.sha256 = Some(sha_hex(b"original"));
    let templates = vec![job_template(
        "a",
        vec![
            served(&base, "a/main.tex"),
            image,
            served(&base, "a/template.json"),
        ],
        None,
    )];
    let dir = tempfile::tempdir().unwrap();
    let plan = plan_downloads(dir.path(), templates, false);
    let error = download_templates(&test_client(), dir.path(), plan, &|_| {})
        .await
        .unwrap_err();
    assert!(error.contains("checksum"), "{error}");
    assert!(!dir.path().join("a/assets/big.png").exists());
    assert!(!dir.path().join("a/assets/big.png.part").exists());
    assert!(!dir.path().join("a/template.json").exists());
    assert_eq!(installed_template_count(dir.path()), 0);
}

fn shared_font_templates(base: &str, sha256: String) -> Vec<PackTemplate> {
    ["a", "b"]
        .into_iter()
        .map(|id| {
            let mut font = served(base, &format!("{id}/fonts/simsun.ttc"));
            font.url = format!("{base}/mirror/simsun.ttc");
            font.sha256 = Some(sha256.clone());
            job_template(
                id,
                vec![
                    served(base, &format!("{id}/main.tex")),
                    font,
                    served(base, &format!("{id}/template.json")),
                ],
                None,
            )
        })
        .collect()
}

fn shared_font_routes(font: Vec<u8>) -> HashMap<String, (u16, Vec<u8>)> {
    let mut routes: HashMap<String, (u16, Vec<u8>)> = HashMap::new();
    for id in ["a", "b"] {
        routes.insert(format!("/files/{id}/main.tex"), (200, b"main".to_vec()));
        routes.insert(format!("/files/{id}/template.json"), (200, b"{}".to_vec()));
    }
    routes.insert("/mirror/simsun.ttc".into(), (200, font));
    routes
}

#[tokio::test]
async fn templates_that_share_a_mirror_file_download_it_once() {
    let font = b"shared font bytes".to_vec();
    let server = serve(shared_font_routes(font.clone())).await;
    let templates = shared_font_templates(&server.base, sha_hex(&font).to_ascii_uppercase());
    let dir = tempfile::tempdir().unwrap();
    let events = Mutex::new(Vec::new());
    let emit = |progress: DownloadProgress| {
        events.lock().unwrap().push((progress.done, progress.total));
    };
    let plan = plan_downloads(dir.path(), templates, false);
    download_templates(&test_client(), dir.path(), plan, &emit)
        .await
        .unwrap();
    assert_eq!(server.hits.lock().unwrap()["/mirror/simsun.ttc"], 1);
    let a = dir.path().join("a/fonts/simsun.ttc");
    let b = dir.path().join("b/fonts/simsun.ttc");
    assert_eq!(std::fs::read(&a).unwrap(), font);
    assert_eq!(std::fs::read(&b).unwrap(), font);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        assert_eq!(
            std::fs::metadata(&a).unwrap().ino(),
            std::fs::metadata(&b).unwrap().ino()
        );
    }
    assert_eq!(installed_template_count(dir.path()), 2);
    assert_eq!(events.into_inner().unwrap().last(), Some(&(6, 6)));
}

#[tokio::test]
async fn a_bad_shared_file_fails_every_template_that_needs_it_after_one_fetch() {
    let server = serve(shared_font_routes(b"tampered".to_vec())).await;
    let templates = shared_font_templates(&server.base, sha_hex(b"original"));
    let dir = tempfile::tempdir().unwrap();
    let plan = plan_downloads(dir.path(), templates, false);
    let error = download_templates(&test_client(), dir.path(), plan, &|_| {})
        .await
        .unwrap_err();
    assert!(error.contains("checksum"), "{error}");
    assert_eq!(server.hits.lock().unwrap()["/mirror/simsun.ttc"], 1);
    assert!(!dir.path().join("a/fonts/simsun.ttc").exists());
    assert!(!dir.path().join("b/fonts/simsun.ttc").exists());
    assert_eq!(installed_template_count(dir.path()), 0);
}

#[tokio::test]
async fn a_shared_file_is_copied_when_it_cannot_be_linked() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("a/fonts/simsun.ttc");
    let dest = dir.path().join("b/fonts/simsun.ttc");
    std::fs::create_dir_all(source.parent().unwrap()).unwrap();
    std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
    std::fs::write(&source, b"font").unwrap();
    std::fs::write(&dest, b"stale").unwrap();
    link_or_copy(&source, &dest).await.unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), b"font");
    assert!(!part_path(&dest).exists());

    let missing = dir.path().join("c/fonts/simsun.ttc");
    let error = link_or_copy(&dir.path().join("gone.ttc"), &missing)
        .await
        .unwrap_err();
    assert!(!error.is_empty());
    assert!(!missing.exists());
    assert!(!part_path(&missing).exists());
}

#[tokio::test]
async fn a_missing_preview_does_not_fail_the_install() {
    let mut routes: HashMap<String, (u16, Vec<u8>)> = HashMap::new();
    routes.insert("/files/a/main.tex".into(), (200, b"main".to_vec()));
    routes.insert("/files/a/template.json".into(), (200, b"{}".to_vec()));
    let server = serve(routes).await;
    let base = server.base.clone();
    let templates = vec![job_template(
        "a",
        vec![
            served(&base, "a/main.tex"),
            served(&base, "a/template.json"),
        ],
        Some(format!("{base}/previews/gone.webp")),
    )];
    let dir = tempfile::tempdir().unwrap();
    let plan = plan_downloads(dir.path(), templates, true);
    download_templates(&test_client(), dir.path(), plan, &|_| {})
        .await
        .unwrap();
    assert!(dir.path().join("a/template.json").is_file());
    assert!(!dir.path().join("a/preview.webp").exists());
}

#[tokio::test]
async fn index_cache_is_served_when_fresh_and_when_offline() {
    let body = index_json(serde_json::json!([index_entry("a")]));
    let server = serve(HashMap::from([(
        "/indexes/open-letter.json".to_string(),
        (200, body.into_bytes()),
    )]))
    .await;
    let base = server.base.clone();
    let pack = CatalogPack {
        id: "open-letter".into(),
        label: "Letters".into(),
        description: String::new(),
        category: String::new(),
        group: "community".into(),
        count: 1,
        bytes: 0,
        license_summary: String::new(),
        covers: Vec::new(),
        source: PackSource::Index(format!("{base}/indexes/open-letter.json")),
    };
    let dir = tempfile::tempdir().unwrap();
    let cache = dir.path().join("indexes").join("open-letter.json");
    let install = dir.path().join("packs").join("open-letter");
    let hits = || {
        server
            .hits
            .lock()
            .unwrap()
            .get("/indexes/open-letter.json")
            .copied()
            .unwrap_or(0)
    };
    let client = test_client();
    let first = load_pack_templates(&client, &pack, &cache, &install, &base, false)
        .await
        .unwrap();
    assert_eq!(first.len(), 1);
    assert!(cache.is_file());
    assert_eq!(hits(), 1);
    load_pack_templates(&client, &pack, &cache, &install, &base, false)
        .await
        .unwrap();
    assert_eq!(hits(), 1);
    load_pack_templates(&client, &pack, &cache, &install, &base, true)
        .await
        .unwrap();
    assert_eq!(hits(), 2);

    let offline = CatalogPack {
        source: PackSource::Index("http://127.0.0.1:9/indexes/open-letter.json".into()),
        ..pack.clone()
    };
    let stale = load_pack_templates(&client, &offline, &cache, &install, &base, true)
        .await
        .unwrap();
    assert_eq!(stale[0].info.id, "a");
    let empty = dir.path().join("indexes").join("none.json");
    assert!(
        load_pack_templates(&client, &offline, &empty, &install, &base, true)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn refresh_prefers_catalog_v2_and_falls_back_to_v1() {
    let root = tempfile::tempdir().unwrap();
    let foreign = serve(HashMap::from([(
        "/catalog-v2.json".to_string(),
        (
            200,
            catalog_v2_json(serde_json::json!([{
                "id": "open-letter",
                "index_url": "https://evil.example/open-letter.json",
            }]))
            .into_bytes(),
        ),
    )]))
    .await;
    assert!(
        refresh_catalog_at(&test_client(), root.path(), &foreign.base)
            .await
            .is_err()
    );
    assert!(!root.path().join(V2_CACHE).exists());

    let v2_ok = catalog_v2_json(serde_json::json!([{
        "id": "open-letter",
        "label": "Letters",
        "count": 1,
        "index_url": format!("{BASE}/indexes/open-letter.json"),
    }]));
    let server = serve(HashMap::from([(
        "/catalog-v2.json".to_string(),
        (200, v2_ok.into_bytes()),
    )]))
    .await;
    refresh_catalog_at(&test_client(), root.path(), &server.base)
        .await
        .unwrap();
    assert!(root.path().join(V2_CACHE).is_file());
    assert!(!root.path().join(V1_CACHE).exists());

    let v1 = serde_json::to_string(&vec![TemplatePack {
        id: "legacy".into(),
        ..v1_pack(vec![])
    }])
    .unwrap();
    let server = serve(HashMap::from([(
        "/catalog.json".to_string(),
        (200, v1.into_bytes()),
    )]))
    .await;
    let root = tempfile::tempdir().unwrap();
    refresh_catalog_at(&test_client(), root.path(), &server.base)
        .await
        .unwrap();
    assert!(root.path().join(V1_CACHE).is_file());
    assert!(!root.path().join(V2_CACHE).exists());
    let packs = catalog_from(Some(root.path()), None, &server.base).unwrap();
    assert_eq!(packs[0].id, "legacy");
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(walk(&path));
        } else {
            found.push(path);
        }
    }
    found
}

#[test]
fn checksums_compare_as_hex_ignoring_case() {
    let digest = Sha256::digest(b"x");
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    assert!(checksum_matches(Some(&hex.to_uppercase()), &digest));
    assert!(checksum_matches(None, &digest));
    assert!(!checksum_matches(Some("00"), &digest));
}

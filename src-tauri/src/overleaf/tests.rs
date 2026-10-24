use std::sync::{Arc, Mutex};

use oleafly_online::test_support::{
    dashboard_page, remote_project_json as remote, socket_handler, zip_bytes, FixtureServer,
    Handler, Reply, Request,
};
use serde_json::json;

use super::client;
use super::import::{self, ImportEvent};
use super::session::{self, Session};
use super::signin;
use super::template;

async fn serve(handler: Handler) -> FixtureServer {
    FixtureServer::start(handler).await
}

#[test]
fn dashboard_urls_match_only_the_project_list() {
    let url = |text: &str| tauri::Url::parse(text).unwrap();
    assert!(signin::is_dashboard(
        &url("https://www.overleaf.com/project"),
        "https://www.overleaf.com"
    ));
    assert!(signin::is_dashboard(
        &url("https://www.overleaf.com/project/"),
        "https://www.overleaf.com"
    ));
    assert!(!signin::is_dashboard(
        &url("https://www.overleaf.com/project/abc"),
        "https://www.overleaf.com"
    ));
    assert!(!signin::is_dashboard(
        &url("https://evil.example/project"),
        "https://www.overleaf.com"
    ));
    assert!(signin::is_dashboard(
        &url("https://latex.uni.edu/sl/project"),
        "https://latex.uni.edu/sl"
    ));
    assert!(!signin::is_dashboard(
        &url("https://latex.uni.edu/project"),
        "https://latex.uni.edu/sl"
    ));
    assert!(signin::cancelled().contains("\"overleaf.sign_in_cancelled\""));
}

#[test]
fn importing_downloads_each_project_and_carries_its_settings() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(async {
        let page = dashboard_page(&json!({ "totalSize": 2, "projects": [remote("a1", "Thesis"), remote("b2", "Broken")] }));
        let archive = zip_bytes(&[
            ("thesis/main.tex", "\\documentclass{book}\\begin{document}x\\end{document}"),
            ("notes.tex", "\\documentclass{article}\\begin{document}y\\end{document}"),
        ]);
        let project = json!({
            "compiler": "xelatex",
            "imageName": "texlive-full:2025.1",
            "rootDoc_id": "m",
            "rootFolder": [{ "docs": [{ "_id": "n", "name": "notes.tex" }], "folders": [{ "name": "thesis", "docs": [{ "_id": "m", "name": "main.tex" }] }] }]
        });
        let socket = socket_handler(project, Arc::new(Mutex::new(0)));
        let fixture = serve(Arc::new(move |request: &Request| {
            if let Some(reply) = socket(request) {
                return reply;
            }
            match request.path.as_str() {
                "/project" => Reply::ok(page.clone()),
                "/project/a1/download/zip" => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        session::save(&base, &Session { cookie: "overleaf_session2=good".into(), user_id: "user-1".into(), email: "ada@uni.edu".into(), saved_by: None }).unwrap();
        let events: Mutex<Vec<ImportEvent>> = Mutex::new(Vec::new());
        let emit = |event: ImportEvent| events.lock().unwrap().push(event);
        let outcomes = import::import(&base, &["a1".to_string(), "b2".to_string(), "a1".to_string(), "zz".to_string()], &emit)
            .await
            .unwrap();
        (base, outcomes, events.into_inner().unwrap())
    });
    let (base, outcomes, events) = result;
    assert_eq!(outcomes.len(), 3);
    let imported = outcomes
        .iter()
        .find(|outcome| outcome.remote_id == "a1")
        .unwrap();
    let project_id = imported.project_id.clone().unwrap();
    for failed in ["b2", "zz"] {
        let outcome = outcomes
            .iter()
            .find(|outcome| outcome.remote_id == failed)
            .unwrap();
        assert!(
            outcome
                .error
                .as_deref()
                .unwrap()
                .contains("overleaf.project_unavailable"),
            "{failed}"
        );
    }
    let meta_path = crate::paths::projects_root()
        .unwrap()
        .join(&project_id)
        .join("project.json");
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(meta_path).unwrap()).unwrap();
    assert_eq!(meta["name"], "Thesis");
    assert_eq!(meta["main_doc"], "thesis/main.tex");
    assert_eq!(meta["engine"], "latexmk");
    assert_eq!(meta["tex_flavor"], "xelatex");
    assert_eq!(meta["importedFrom"]["projectId"], "a1");
    assert_eq!(meta["importedFrom"]["server"], base.as_str());
    assert_eq!(meta["importedFrom"]["texLive"], "2025");
    assert!(events.iter().any(
        |event| matches!(event, ImportEvent::Downloading { remote_id, .. } if remote_id == "a1")
    ));
    assert!(events
        .iter()
        .any(|event| matches!(event, ImportEvent::Importing { remote_id } if remote_id == "a1")));
    assert!(events.iter().any(|event| matches!(event, ImportEvent::Done { remote_id, main_doc, .. } if remote_id == "a1" && main_doc.as_deref() == Some("thesis/main.tex"))));
    assert_eq!(
        import::imported_projects(&base).get("a1"),
        Some(&project_id)
    );
    let leftovers: Vec<_> = std::fs::read_dir(crate::paths::projects_root().unwrap())
        .unwrap()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".oleafly-online-import")
        })
        .collect();
    assert!(leftovers.is_empty());
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn importing_keeps_a_project_whose_files_all_sit_in_one_folder_as_it_is_online() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let outcomes = runtime.block_on(async {
        let page = dashboard_page(&json!({ "totalSize": 1, "projects": [remote("a1", "Thesis")] }));
        let archive = zip_bytes(&[
            ("thesis/main.tex", "\\documentclass{book}\\begin{document}\\input{thesis/chapters/intro}\\end{document}"),
            ("thesis/chapters/intro.tex", "Hello."),
        ]);
        let project = json!({
            "compiler": "pdflatex",
            "rootDoc_id": "m",
            "rootFolder": [{ "docs": [], "folders": [{ "name": "thesis", "docs": [{ "_id": "m", "name": "main.tex" }], "folders": [{ "name": "chapters", "docs": [{ "_id": "i", "name": "intro.tex" }] }] }] }]
        });
        let socket = socket_handler(project, Arc::new(Mutex::new(0)));
        let fixture = serve(Arc::new(move |request: &Request| {
            if let Some(reply) = socket(request) {
                return reply;
            }
            match request.path.as_str() {
                "/project" => Reply::ok(page.clone()),
                "/project/a1/download/zip" => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        session::save(&base, &Session { cookie: "overleaf_session2=good".into(), user_id: "user-1".into(), email: "ada@uni.edu".into(), saved_by: None }).unwrap();
        import::import(&base, &["a1".to_string()], &|_| {}).await.unwrap()
    });
    let project_id = outcomes[0].project_id.clone().unwrap();
    let dir = crate::paths::projects_root().unwrap().join(&project_id);
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
    assert_eq!(meta["main_doc"], "thesis/main.tex");
    assert!(dir.join("thesis/main.tex").is_file());
    assert!(dir.join("thesis/chapters/intro.tex").is_file());
    assert!(!dir.join("main.tex").exists());
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn listing_through_the_shim_still_says_signed_out_in_the_app_format() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let fixture = serve(Arc::new(|_: &Request| {
            Reply::status(302).header("Location", "/login")
        }))
        .await;
        let base = fixture.base.clone();
        let error = import::list(&base).await.err().unwrap();
        assert!(error.contains("\"overleaf.signed_out\""), "{error}");
        session::save(
            &base,
            &Session {
                cookie: "s=old".into(),
                user_id: "u".into(),
                email: String::new(),
                saved_by: None,
            },
        )
        .unwrap();
        let error = import::list(&base).await.err().unwrap();
        assert!(client::is_expired(&error), "{error}");
        assert!(session::load(&base).unwrap().is_none());
    });
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

// --- Gallery templates and account projects as custom templates -----------

fn gallery_page(page: &str) -> String {
    format!(
        "<!DOCTYPE html><html><head><meta name=\"og:title\" content=\"Lab Thesis &amp; Report\">\
         <meta name=\"ol-csrfToken\" content=\"public-token\"></head><body>\
         <h1 class=\"h2\">Lab Thesis</h1>\
         <a class=\"btn btn-primary\" href=\"/project/new/template/123?brandVariationId=7&amp;id=456&amp;latexEngine=pdflatex&amp;mainFile=thesis%2Fmain.tex&amp;templateName=Lab+Thesis&amp;texImage=texlive-full%3A2025.1\">Open as Template</a>\
         <a class=\"btn\" href=\"{page}.pdf\" target=\"_blank\">View PDF</a>\
         <div class=\"template-detail\"><div><b>Author:</b></div><div>Ada <i>Lovelace</i></div></div>\
         <div class=\"template-detail\"><div><b>License:</b></div><div>Creative Commons CC BY 4.0</div></div>\
         <div class=\"template-detail\"><div><b>Abstract:</b></div><div class=\"gallery-abstract\"><p>A thesis</p>\n<p>for the lab &lt;group&gt;.</p></div></div>\
         </body></html>"
    )
}

#[test]
fn gallery_links_are_accepted_from_any_language_and_from_the_import_server() {
    let default = session::DEFAULT_SERVER;
    let page = "/latex/templates/ieee-conference-template/grfzhhncsfqn";
    for link in [
        "https://www.overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn",
        "de.overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn/",
        "https://overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn.pdf",
        "  https://www.overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn?ref=x  ",
    ] {
        let parsed = template::parse_link(link, default).unwrap();
        assert_eq!(parsed.base, default, "{link}");
        assert_eq!(parsed.page, page, "{link}");
    }
    for link in [
        "https://www.overleaf.com/latex/examples/a-tikz-figure/abc123",
        "https://www.overleaf.com/articles/a-paper/abc123",
    ] {
        assert!(template::parse_link(link, default).is_ok(), "{link}");
    }
    for link in [
        "https://example.com/latex/templates/x/abc",
        "https://www.overleaf.com/project/64a1",
        "https://www.overleaf.com/latex/templates/x",
        "https://www.overleaf.com/latex/templates/x/abc/extra",
        "ftp://www.overleaf.com/latex/templates/x/abc",
        "https://www.overleaf.com/latex/templates/x%20y/abc",
        "not a link",
    ] {
        let error = template::parse_link(link, default).unwrap_err();
        assert!(
            error.contains("overleaf.template_link_invalid"),
            "{link}: {error}"
        );
    }
    let university = "https://latex.uni.edu/sharelatex";
    let parsed = template::parse_link(
        "https://latex.uni.edu/sharelatex/latex/templates/lab/abc",
        university,
    )
    .unwrap();
    assert_eq!(parsed.base, university);
    assert_eq!(parsed.page, "/latex/templates/lab/abc");
    assert_eq!(
        parsed.url(),
        "https://latex.uni.edu/sharelatex/latex/templates/lab/abc"
    );
    assert!(template::parse_link(
        "https://latex.uni.edu/other/latex/templates/lab/abc",
        university
    )
    .is_err());
}

#[test]
fn a_gallery_page_yields_its_details_and_the_request_that_copies_it() {
    let page_path = "/latex/templates/lab-thesis/abc";
    let page = template::parse_page(&gallery_page(page_path), page_path);
    assert_eq!(page.title.as_deref(), Some("Lab Thesis & Report"));
    assert_eq!(page.author.as_deref(), Some("Ada Lovelace"));
    assert_eq!(page.license.as_deref(), Some("Creative Commons CC BY 4.0"));
    assert_eq!(
        page.description.as_deref(),
        Some("A thesis for the lab <group>.")
    );
    assert!(page.has_pdf);
    let open = page.open.clone().unwrap();
    assert_eq!(open.version_id, "123");
    assert_eq!(open.template_id, "456");
    assert_eq!(open.main_file.as_deref(), Some("thesis/main.tex"));
    assert_eq!(open.image.as_deref(), Some("texlive-full:2025.1"));
    assert_eq!(
        template::create_body(&open, " My thesis "),
        json!({
            "templateId": "456",
            "templateVersionId": "123",
            "templateName": "My thesis",
            "compiler": "pdflatex",
            "mainFile": "thesis/main.tex",
            "imageName": "texlive-full:2025.1",
            "brandVariationId": "7",
        })
    );
    let dvi = template::OpenAsTemplate {
        engine: Some("latex_dvipdf".into()),
        ..open
    };
    assert_eq!(template::create_body(&dvi, "")["compiler"], "latex");
    assert!(template::create_body(&dvi, "")
        .get("templateName")
        .is_none());

    let bare = template::parse_page("<html><body><h1>Nothing</h1></body></html>", page_path);
    assert!(bare.open.is_none());
    assert!(!bare.has_pdf);
    let forged = template::parse_page(
        "<a href=\"/project/new/template/12x?id=4\">Open</a>",
        page_path,
    );
    assert!(forged.open.is_none());

    assert_eq!(client::project_id_in("/project/64ab"), Some("64ab".into()));
    assert_eq!(
        client::project_id_in("https://www.overleaf.com/project/64ab?x=1"),
        Some("64ab".into())
    );
    assert_eq!(
        client::project_id_in("/sharelatex/project/64ab/"),
        Some("64ab".into())
    );
    assert_eq!(client::project_id_in("/login?redir=/project/64ab"), None);
    assert_eq!(client::project_id_in("/project/new/template"), None);
}

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

fn custom_template_dirs() -> Vec<std::path::PathBuf> {
    let root = crate::templates::custom_templates_root().unwrap();
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries.flatten().map(|entry| entry.path()).collect()
}

#[test]
fn a_gallery_link_is_copied_into_the_account_and_saved_as_a_template() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let page_path = "/latex/templates/lab-thesis/abc";
    let (base, result, posts) = run(async {
        let page = gallery_page(page_path);
        let dashboard = dashboard_page(&json!({ "projects": [] }));
        // Everything sits in one folder, as in many online projects. The
        // layout is kept so the server's main file path stays valid.
        let archive = zip_bytes(&[
            (
                "thesis/main.tex",
                "\\documentclass{report}\\begin{document}x\\end{document}",
            ),
            ("thesis/LICENSE", "CC BY"),
            ("thesis/logo.png", "png"),
        ]);
        let fixture = serve(Arc::new(move |request: &Request| {
            match (request.method.as_str(), request.path.as_str()) {
                ("GET", "/project") => Reply::ok(dashboard.clone()),
                ("GET", path) if path == page_path => Reply::ok(page.clone()),
                ("POST", "/project/new/template") => {
                    Reply::status(302).header("Location", "/project/p-new")
                }
                ("GET", "/project/p-new/download/zip") => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        session::save(
            &base,
            &Session {
                cookie: "overleaf_session2=good".into(),
                user_id: "user-1".into(),
                email: "ada@uni.edu".into(),
                saved_by: None,
            },
        )
        .unwrap();
        let result = template::import_template(
            Some(&base),
            &format!("{base}{page_path}"),
            "Our lab thesis".into(),
            None,
            Vec::new(),
        )
        .await;
        (base, result, fixture.requests("/project/new/template"))
    });
    let id = result.unwrap();
    let dir = crate::templates::custom_templates_root().unwrap().join(&id);
    let manifest = crate::templates::read_manifest(&dir).unwrap();
    assert_eq!(manifest.name, "Our lab thesis");
    assert_eq!(manifest.category, "Custom");
    assert_eq!(manifest.main_doc, "thesis/main.tex");
    assert_eq!(manifest.tex_flavor.as_deref(), Some("pdflatex"));
    assert_eq!(manifest.description, "A thesis for the lab <group>.");
    let license = manifest.license.unwrap();
    assert_eq!(license.spdx, "Creative Commons CC BY 4.0");
    assert_eq!(license.author, "Ada Lovelace");
    assert_eq!(license.url, format!("{base}{page_path}"));
    assert!(dir.join("files/thesis/LICENSE").is_file());
    assert!(dir.join("files/thesis/logo.png").is_file());
    assert!(!dir.join("files/main.tex").exists());
    assert_eq!(posts.len(), 1);
    let post = &posts[0];
    assert_eq!(
        post.headers.get("x-csrf-token").map(String::as_str),
        Some("csrf-123")
    );
    assert!(post
        .headers
        .get("cookie")
        .unwrap()
        .contains("overleaf_session2=good"));
    let body: serde_json::Value = serde_json::from_str(&post.body).unwrap();
    assert_eq!(body["templateId"], "456");
    assert_eq!(body["templateVersionId"], "123");
    assert_eq!(body["templateName"], "Our lab thesis");
    assert_eq!(custom_template_dirs(), vec![dir]);
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn a_gallery_link_needs_a_sign_in_and_reports_removed_templates_and_expired_sign_ins() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let page_path = "/latex/templates/lab-thesis/abc";
    let (signed_out, removed, expired, still_signed_in) = run(async {
        let page = gallery_page(page_path);
        let dashboard = dashboard_page(&json!({ "projects": [] }));
        let fixture = serve(Arc::new(move |request: &Request| {
            match (request.method.as_str(), request.path.as_str()) {
                ("GET", "/project") => Reply::ok(dashboard.clone()),
                ("GET", path) if path == page_path => Reply::ok(page.clone()),
                ("POST", "/project/new/template") => {
                    Reply::status(302).header("Location", "/login?redir=%2Fproject")
                }
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        let link = format!("{base}{page_path}");
        let signed_out =
            template::import_template(Some(&base), &link, "x".into(), None, Vec::new()).await;
        session::save(
            &base,
            &Session {
                cookie: "overleaf_session2=good".into(),
                user_id: "user-1".into(),
                email: String::new(),
                saved_by: None,
            },
        )
        .unwrap();
        let removed = template::overleaf_template_details(
            Some(base.clone()),
            format!("{base}/latex/templates/gone/zzz"),
        )
        .await;
        let expired =
            template::import_template(Some(&base), &link, "x".into(), None, Vec::new()).await;
        let still_signed_in = session::load(&base).unwrap().is_some();
        (signed_out, removed, expired, still_signed_in)
    });
    assert!(signed_out.unwrap_err().contains("overleaf.signed_out"));
    assert!(removed
        .unwrap_err()
        .contains("overleaf.template_unavailable"));
    assert!(client::is_expired(&expired.unwrap_err()));
    assert!(!still_signed_in, "an expired sign-in is forgotten");
    assert!(custom_template_dirs().iter().all(|path| !path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with(".download-")));
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn an_account_project_is_saved_as_a_template_with_its_main_file_and_compiler() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let (result, missing) = run(async {
        let page = dashboard_page(&json!({ "projects": [remote("a1", "Lab master")] }));
        let archive = zip_bytes(&[
            (
                "thesis/main.tex",
                "\\documentclass{book}\\begin{document}x\\end{document}",
            ),
            (
                "notes.tex",
                "\\documentclass{article}\\begin{document}y\\end{document}",
            ),
        ]);
        let project = json!({
            "compiler": "xelatex",
            "rootDoc_id": "m",
            "rootFolder": [{ "docs": [{ "_id": "n", "name": "notes.tex" }], "folders": [{ "name": "thesis", "docs": [{ "_id": "m", "name": "main.tex" }] }] }]
        });
        let socket = socket_handler(project, Arc::new(Mutex::new(0)));
        let fixture = serve(Arc::new(move |request: &Request| {
            if let Some(reply) = socket(request) {
                return reply;
            }
            match request.path.as_str() {
                "/project" => Reply::ok(page.clone()),
                "/project/a1/download/zip" => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        session::save(
            &base,
            &Session {
                cookie: "overleaf_session2=good".into(),
                user_id: "user-1".into(),
                email: String::new(),
                saved_by: None,
            },
        )
        .unwrap();
        let result =
            template::save_project_as_template(Some(&base), "a1", "Lab master".into(), Vec::new())
                .await;
        let missing =
            template::save_project_as_template(Some(&base), "zz", "Gone".into(), Vec::new()).await;
        (result, missing)
    });
    let id = result.unwrap();
    let manifest = crate::templates::read_manifest(
        &crate::templates::custom_templates_root().unwrap().join(&id),
    )
    .unwrap();
    assert_eq!(manifest.name, "Lab master");
    assert_eq!(manifest.main_doc, "thesis/main.tex");
    assert_eq!(manifest.tex_flavor.as_deref(), Some("xelatex"));
    assert!(missing
        .unwrap_err()
        .contains("overleaf.project_unavailable"));
    let projects = crate::paths::projects_root().unwrap();
    assert!(std::fs::read_dir(projects).map_or(true, |mut entries| entries.next().is_none()));
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

// 0.4.8 I: the browser sign-in copy signs in with the main webview's cookies.
fn app_cookie(
    name: &str,
    value: &str,
    domain: Option<&str>,
    path: Option<&str>,
    secure: bool,
) -> super::AppCookie {
    (
        name.into(),
        value.into(),
        domain.map(str::to_string),
        path.map(str::to_string),
        secure,
    )
}

#[test]
fn app_cookie_header_keeps_only_cookies_for_the_service_host() {
    let cookies = vec![
        app_cookie("session2", "abc", Some(".latex.example"), Some("/"), true),
        app_cookie("other", "x", Some("evil-latex.example"), Some("/"), false),
        app_cookie(
            "scoped",
            "y",
            Some("www.latex.example"),
            Some("/admin"),
            false,
        ),
    ];
    assert_eq!(
        super::app_cookie_header(&cookies, "https://www.latex.example").unwrap(),
        "session2=abc"
    );
}

#[test]
fn app_cookie_header_refuses_when_nothing_matches() {
    let error = super::app_cookie_header(&[], "https://www.latex.example").unwrap_err();
    assert!(
        error.contains("\"code\":\"overleaf.browser_sign_in_missing\""),
        "{error}"
    );
    assert!(error.contains("www.latex.example"), "{error}");
}

#[test]
fn secure_cookies_never_go_to_plain_http() {
    let cookies = vec![app_cookie("s", "v", Some("127.0.0.1"), None, true)];
    assert!(super::app_cookie_header(&cookies, "http://192.168.1.5:8080").is_err());
    let local = vec![app_cookie("s", "v", Some("192.168.1.5"), None, true)];
    assert!(super::app_cookie_header(&local, "http://192.168.1.5:8080").is_err());
}

#[test]
fn a_missing_cookie_error_never_carries_cookie_values() {
    let cookies = vec![app_cookie(
        "session2",
        "secret-cookie-value",
        Some("elsewhere.example"),
        Some("/"),
        true,
    )];
    let error = super::app_cookie_header(&cookies, "https://www.latex.example").unwrap_err();
    assert!(!error.contains("secret-cookie-value"), "{error}");
}

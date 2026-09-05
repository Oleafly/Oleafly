use super::model::{
    AddResearchRootRequest, LinkedResearchRoot, ResearchDocumentEngine, ResearchProjectRequest,
    ResearchRootAccess, ResearchRootConsumer, ResearchRootOperation, ResearchRootRole,
    ResearchStarter, ResearchWorkspace,
};
use super::{roots, setup};
use std::collections::HashSet;

fn request(engine: ResearchDocumentEngine, starter: ResearchStarter) -> ResearchProjectRequest {
    ResearchProjectRequest {
        name: "Evidence and uncertainty".into(),
        engine,
        starter,
    }
}

#[test]
fn workspace_metadata_round_trips() {
    let temp = tempfile::tempdir().unwrap();
    let path = roots::workspace_path_for_test(temp.path(), "project-one");
    let workspace = ResearchWorkspace {
        version: 1,
        primary_project_id: "project-one".into(),
        roots: vec![LinkedResearchRoot {
            id: "root-a".into(),
            canonical_path: temp.path().to_string_lossy().into_owned(),
            identity: "test-identity".into(),
            label: "Dataset".into(),
            role: ResearchRootRole::Data,
            access: ResearchRootAccess::ReadOnly,
            created_at_ms: 5,
        }],
        updated_at_ms: 6,
    };
    roots::write_workspace_for_test(&path, &workspace).unwrap();
    assert_eq!(
        roots::read_workspace_for_test(&path, "project-one").unwrap(),
        workspace
    );
}

#[test]
fn every_engine_preview_has_a_supported_main_document() {
    for (engine, expected_path, expected_engine) in [
        (ResearchDocumentEngine::Latex, "main.tex", "xetex"),
        (ResearchDocumentEngine::Typst, "main.typ", "typst"),
        (ResearchDocumentEngine::Markdown, "main.md", "markdown"),
    ] {
        let preview = setup::build_preview(request(engine, ResearchStarter::Article)).unwrap();
        assert_eq!(preview.main_document, expected_path);
        assert!(preview
            .files
            .iter()
            .find(|file| file.path == expected_path)
            .and_then(|file| file.content.as_ref())
            .is_some());
        assert!(crate::document_engine::engine_for(expected_engine, expected_path).is_ok());
    }
}

#[test]
fn preview_matches_the_created_research_tree() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let temp = tempfile::tempdir().unwrap();
    let previous = std::env::var_os("OLEAFLY_DATA_DIR");
    std::env::set_var("OLEAFLY_DATA_DIR", temp.path());
    let projects = crate::paths::projects_root().unwrap();
    let request = request(
        ResearchDocumentEngine::Typst,
        ResearchStarter::ReproducibleAnalysis,
    );
    let preview = setup::build_preview(request.clone()).unwrap();
    let project_id = setup::create_at_for_test(&projects, request, |_, destination| {
        std::fs::write(destination.join("main.typ"), "template").map_err(|error| error.to_string())
    })
    .unwrap();
    let project = projects.join(project_id);
    for (relative, content) in setup::preview_files(&preview) {
        let path = project.join(relative);
        match content {
            Some(expected) => assert_eq!(std::fs::read_to_string(path).unwrap(), expected),
            None => assert!(path.is_dir()),
        }
    }
    match previous {
        Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
        None => std::env::remove_var("OLEAFLY_DATA_DIR"),
    }
}

#[test]
fn invalid_names_do_not_create_a_destination() {
    let temp = tempfile::tempdir().unwrap();
    let result = setup::create_at_for_test(
        temp.path(),
        ResearchProjectRequest {
            name: "../paper".into(),
            engine: ResearchDocumentEngine::Latex,
            starter: ResearchStarter::Thesis,
        },
        |_, _| Ok(()),
    );
    assert!(result.is_err());
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn project_ids_do_not_collide_or_overwrite() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let temp = tempfile::tempdir().unwrap();
    let previous = std::env::var_os("OLEAFLY_DATA_DIR");
    std::env::set_var("OLEAFLY_DATA_DIR", temp.path());
    let projects = crate::paths::projects_root().unwrap();
    let first = setup::create_at_for_test(
        &projects,
        request(ResearchDocumentEngine::Markdown, ResearchStarter::Article),
        |_, destination| {
            std::fs::write(destination.join("main.md"), "template")
                .map_err(|error| error.to_string())
        },
    )
    .unwrap();
    let second = setup::create_at_for_test(
        &projects,
        request(ResearchDocumentEngine::Markdown, ResearchStarter::Article),
        |_, destination| {
            std::fs::write(destination.join("main.md"), "template")
                .map_err(|error| error.to_string())
        },
    )
    .unwrap();
    assert_ne!(first, second);
    assert!(projects.join(first).join("project.json").is_file());
    assert!(projects.join(second).join("project.json").is_file());
    match previous {
        Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
        None => std::env::remove_var("OLEAFLY_DATA_DIR"),
    }
}

#[cfg(unix)]
#[test]
fn resolver_rejects_symlink_traversal_and_task_writes() {
    use std::os::unix::fs::symlink;

    let _env_guard = crate::paths::data_dir_env_lock();
    let temp = tempfile::tempdir().unwrap();
    let previous = std::env::var_os("OLEAFLY_DATA_DIR");
    std::env::set_var("OLEAFLY_DATA_DIR", temp.path().join("data"));
    let projects = crate::paths::projects_root().unwrap();
    let project_id = "root-safety";
    std::fs::create_dir(projects.join(project_id)).unwrap();
    std::fs::write(projects.join(project_id).join("project.json"), "{}").unwrap();
    let linked = temp.path().join("linked");
    let outside = temp.path().join("outside");
    std::fs::create_dir(&linked).unwrap();
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("secret.txt"), "secret").unwrap();
    symlink(&outside, linked.join("escape")).unwrap();
    let store = crate::paths::oleafly_root()
        .unwrap()
        .join("research-workspaces");
    std::fs::create_dir_all(&store).unwrap();
    let workspace = ResearchWorkspace {
        version: 1,
        primary_project_id: project_id.into(),
        roots: vec![LinkedResearchRoot {
            id: "root-a".into(),
            canonical_path: linked
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            identity: {
                use std::os::unix::fs::MetadataExt as _;
                let metadata = std::fs::metadata(&linked).unwrap();
                format!("unix:{}:{}", metadata.dev(), metadata.ino())
            },
            label: "Data".into(),
            role: ResearchRootRole::Data,
            access: ResearchRootAccess::ReadWrite,
            created_at_ms: 1,
        }],
        updated_at_ms: 1,
    };
    roots::write_workspace_for_test(&store.join(format!("{project_id}.json")), &workspace).unwrap();
    let task_capability = roots::capabilities(project_id, ResearchRootConsumer::Task).unwrap();
    assert_eq!(
        task_capability[0].effective_access,
        ResearchRootAccess::ReadOnly
    );
    assert_eq!(task_capability[0].canonical_path, None);
    assert!(roots::resolve_root_path(
        project_id,
        "root-a",
        "escape/secret.txt",
        ResearchRootOperation::Read,
        ResearchRootConsumer::Native,
        false,
    )
    .is_err());
    assert!(roots::write_root_file(
        project_id,
        "root-a",
        "task-output.txt",
        b"blocked",
        ResearchRootConsumer::Task,
    )
    .is_err());
    assert!(!linked.join("task-output.txt").exists());
    match previous {
        Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
        None => std::env::remove_var("OLEAFLY_DATA_DIR"),
    }
}

#[test]
fn removing_metadata_never_removes_source_files() {
    let temp = tempfile::tempdir().unwrap();
    let linked = temp.path().join("linked");
    std::fs::create_dir(&linked).unwrap();
    std::fs::write(linked.join("source.csv"), "a,b\n1,2\n").unwrap();
    let workspace = ResearchWorkspace {
        version: 1,
        primary_project_id: "project-one".into(),
        roots: vec![LinkedResearchRoot {
            id: "root-a".into(),
            canonical_path: linked.to_string_lossy().into_owned(),
            identity: "test-identity".into(),
            label: "Data".into(),
            role: ResearchRootRole::Data,
            access: ResearchRootAccess::ReadOnly,
            created_at_ms: 1,
        }],
        updated_at_ms: 1,
    };
    let metadata = temp.path().join("project-one.json");
    roots::write_workspace_for_test(&metadata, &workspace).unwrap();
    let workspace = roots::remove_root_for_test(&metadata, "project-one", "root-a").unwrap();
    assert!(linked.join("source.csv").is_file());
    assert!(workspace.roots.is_empty());
}

#[cfg(unix)]
#[test]
fn a_replaced_linked_folder_is_stale_until_relinked() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let temp = tempfile::tempdir().unwrap();
    let previous = std::env::var_os("OLEAFLY_DATA_DIR");
    std::env::set_var("OLEAFLY_DATA_DIR", temp.path().join("data"));
    let projects = crate::paths::projects_root().unwrap();
    let project_id = "stale-root";
    std::fs::create_dir(projects.join(project_id)).unwrap();
    std::fs::write(projects.join(project_id).join("project.json"), "{}").unwrap();
    let linked = temp.path().join("linked");
    std::fs::create_dir(&linked).unwrap();
    let workspace = roots::add_root(AddResearchRootRequest {
        project_id: project_id.into(),
        path: linked.to_string_lossy().into_owned(),
        label: "Study data".into(),
        role: ResearchRootRole::Data,
        access: ResearchRootAccess::ReadOnly,
    })
    .unwrap();
    let root_id = workspace.roots[0].id.clone();
    std::fs::rename(&linked, temp.path().join("old-linked")).unwrap();
    std::fs::create_dir(&linked).unwrap();
    let error = roots::capabilities(project_id, ResearchRootConsumer::Native).unwrap_err();
    assert!(error.contains("replaced"));
    roots::remove_root(project_id, &root_id).unwrap();
    assert!(linked.is_dir());
    match previous {
        Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
        None => std::env::remove_var("OLEAFLY_DATA_DIR"),
    }
}

#[test]
fn native_writes_require_explicit_read_write_access() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let temp = tempfile::tempdir().unwrap();
    let previous = std::env::var_os("OLEAFLY_DATA_DIR");
    std::env::set_var("OLEAFLY_DATA_DIR", temp.path().join("data"));
    let projects = crate::paths::projects_root().unwrap();
    let project_id = "root-access";
    std::fs::create_dir(projects.join(project_id)).unwrap();
    std::fs::write(projects.join(project_id).join("project.json"), "{}").unwrap();
    let linked = temp.path().join("linked");
    std::fs::create_dir(&linked).unwrap();
    let workspace = roots::add_root(AddResearchRootRequest {
        project_id: project_id.into(),
        path: linked.to_string_lossy().into_owned(),
        label: "Analysis".into(),
        role: ResearchRootRole::Analysis,
        access: ResearchRootAccess::ReadOnly,
    })
    .unwrap();
    let root = workspace.roots[0].clone();
    let acp_capability = roots::capabilities(project_id, ResearchRootConsumer::Acp).unwrap();
    assert_eq!(acp_capability[0].canonical_path, None);
    assert_eq!(acp_capability[0].exposure, "context_only");
    assert!(roots::write_root_file(
        project_id,
        &root.id,
        "result.txt",
        b"first",
        ResearchRootConsumer::Native,
    )
    .is_err());
    roots::update_root(super::model::UpdateResearchRootRequest {
        project_id: project_id.into(),
        root_id: root.id.clone(),
        label: root.label,
        role: root.role,
        access: ResearchRootAccess::ReadWrite,
    })
    .unwrap();
    roots::write_root_file(
        project_id,
        &root.id,
        "result.txt",
        b"first",
        ResearchRootConsumer::Native,
    )
    .unwrap();
    assert_eq!(std::fs::read(linked.join("result.txt")).unwrap(), b"first");
    match previous {
        Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
        None => std::env::remove_var("OLEAFLY_DATA_DIR"),
    }
}

#[test]
fn all_starters_have_distinct_section_sets_and_shared_workflow_files() {
    let mut mains = HashSet::new();
    for starter in [
        ResearchStarter::Article,
        ResearchStarter::LiteratureReview,
        ResearchStarter::Thesis,
        ResearchStarter::ReproducibleAnalysis,
    ] {
        let preview =
            setup::build_preview(request(ResearchDocumentEngine::Latex, starter)).unwrap();
        let files = setup::preview_files(&preview);
        assert!(files.contains_key("research/reading-list.md"));
        assert!(files.contains_key("research/claims.md"));
        assert!(files.contains_key("review/notes.md"));
        mains.insert(files.get("main.tex").unwrap().clone().unwrap());
    }
    assert_eq!(mains.len(), 4);
}

const LOCAL_COPY: &str = "collab.localCopy";
const NAME: &str = "{{name}}";

pub(super) fn local_copy_name_in(locale: &str, name: &str) -> String {
    let template = crate::i18n::t_in(locale, LOCAL_COPY);
    if let Some((before, after)) = template.split_once(NAME) {
        let marked = name.len() > before.len() + after.len()
            && name.starts_with(before)
            && name.ends_with(after);
        if marked && !(before.is_empty() && after.is_empty()) {
            return name.to_owned();
        }
    }
    crate::i18n::t_with_in(locale, LOCAL_COPY, &[("name", name)])
}

pub(super) fn name_local_copy(project_id: &str) {
    if crate::project_location::locate(project_id).is_err() {
        return;
    }
    let Ok(meta) = crate::project::read_meta(project_id) else {
        return;
    };
    let renamed = local_copy_name_in(crate::i18n::current(), &meta.name);
    if renamed != meta.name {
        if let Err(error) = crate::project::rename_project_blocking(project_id.to_owned(), renamed)
        {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not name {project_id} as a local copy: {error}"
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    use oleafly_collab::doc::ProjectDoc;
    use oleafly_collab::live::LiveProject;
    use oleafly_collab::sync::{
        spawn_live, EndReason, LiveEvent, LiveLink, LiveStatus, SharedLive,
    };
    use oleafly_collab::{save_binding, ServerClient, ServerUrl};
    use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
    use oleafly_collab_protocol::projects::ProjectRole;
    use tokio::sync::mpsc;

    use super::super::super::disk::DiskState;
    use super::super::{
        pump, Active, LiveHost, MergedPayload, NewDevicePayload, PresenceLeftPayload,
        PresencePayload, RolePayload, StatusPayload, WrittenTexts,
    };
    use super::*;
    use crate::collab::state::CollabState;
    use crate::collab::testing::TempLibrary;
    use crate::folder_watch::FolderChange;

    #[test]
    fn a_local_copy_name_follows_the_language_and_is_never_added_twice() {
        assert_eq!(
            local_copy_name_in("en", "R3 Paper"),
            "R3 Paper (local copy)"
        );
        assert_eq!(
            local_copy_name_in("en", "R3 Paper (local copy)"),
            "R3 Paper (local copy)"
        );
        assert_eq!(
            local_copy_name_in("de", "R3 Paper"),
            "R3 Paper (lokale Kopie)"
        );
        assert_eq!(local_copy_name_in("ja", "論文"), "論文（ローカルコピー）");
        assert_eq!(
            local_copy_name_in("ja", "論文（ローカルコピー）"),
            "論文（ローカルコピー）"
        );
    }

    struct Quiet;

    impl LiveHost for Quiet {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
    }

    fn renamed_after(reason: EndReason) -> String {
        let library = TempLibrary::new();
        let root = library.project("r3-paper", &[("main.tex", "x")]);
        let mut meta = crate::project::read_meta("r3-paper").unwrap();
        meta.name = "R3 Paper".to_owned();
        crate::project::write_meta("r3-paper", &meta).unwrap();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let server = ServerId::new_v7();
            let paths = state.paths().unwrap().clone();
            save_binding(
                &paths,
                "r3-paper",
                &oleafly_collab::ShareBinding {
                    server_url: "http://127.0.0.1:9".to_owned(),
                    server_id: server,
                    shared_project_id: SharedProjectId::new_v7(),
                    role: ProjectRole::Editor,
                    created_at: 1,
                },
            )
            .unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: server,
                project: SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let live = LiveProject::new(ProjectDoc::create().unwrap(), 0, ProjectRole::Editor);
            let shared: SharedLive = Arc::new(Mutex::new(live));
            let (unused, _unused) = mpsc::unbounded_channel();
            let (writer, _writer) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared), unused);
            let active = Arc::new(Active {
                project_id: "r3-paper".to_owned(),
                root,
                document_dir: dir.path().join("document"),
                disk_file: dir.path().join("disk.json"),
                live: shared,
                handle,
                link,
                disk: Mutex::new(DiskState::default()),
                host: Arc::new(Quiet),
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(WrittenTexts::default()),
            });
            let (events, receiver) = mpsc::unbounded_channel();
            let pumping = tokio::spawn(pump(Arc::downgrade(&active), receiver, paths));
            events
                .send(LiveEvent::Status(LiveStatus::Ended { reason }))
                .unwrap();
            drop(events);
            pumping.await.unwrap();
            active.handle.stop();
        });
        crate::project::read_meta("r3-paper").unwrap().name
    }

    #[test]
    fn a_project_whose_access_was_removed_is_renamed_as_a_local_copy() {
        let expected = local_copy_name_in(crate::i18n::current(), "R3 Paper");
        assert_ne!(expected, "R3 Paper");
        assert_eq!(renamed_after(EndReason::AccessEnded), expected);
        assert_eq!(renamed_after(EndReason::Removed), expected);
        assert_eq!(renamed_after(EndReason::Stopped), "R3 Paper");
    }
}

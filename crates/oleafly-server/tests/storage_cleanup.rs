mod people;

use std::path::Path;

use loro::{ExportMode, LoroDoc, TreeID, TreeParentId};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_server::blobs::cleanup::{self, UNUSED_FILE_GRACE_MS};
use oleafly_server::blobs::{sha256_hex, snapshot_key};
use oleafly_server::clock::Clock;
use oleafly_server::config::{BlobStoreConfig, ServerConfig};
use oleafly_server::projects;
use oleafly_server::snapshots::Policy;
use oleafly_server::state::DAY_MS;
use oleafly_server::test_support::{test_config, MockS3, MockS3Fault};
use people::{
    call, first_snapshot, put_bytes, share_project, signed_by, stage_with, Person, Stage,
};
use reqwest::{Method, StatusCode};

const PREFIX: &str = "oleafly";

enum Store {
    Disk,
    Bucket(MockS3),
}

impl Store {
    async fn both() -> [Store; 2] {
        [Store::Disk, Store::Bucket(MockS3::start().await)]
    }

    fn config(&self, data_dir: &Path) -> ServerConfig {
        let mut config = test_config();
        config.data_dir = data_dir.to_path_buf();
        if let Store::Bucket(bucket) = self {
            config.blob_store = BlobStoreConfig::S3(Box::new(bucket.config(PREFIX)));
        }
        config
    }

    fn bucket(&self) -> &MockS3 {
        match self {
            Store::Bucket(bucket) => bucket,
            Store::Disk => panic!("this store has no bucket"),
        }
    }

    fn holds_file(&self, data_dir: &Path, hash: &str) -> bool {
        match self {
            Store::Disk => data_dir.join("blobs").join(&hash[..2]).join(hash).exists(),
            Store::Bucket(bucket) => bucket
                .object(&format!("{PREFIX}/{}/{hash}", &hash[..2]))
                .is_some(),
        }
    }

    fn snapshot_objects(&self, data_dir: &Path, project: SharedProjectId) -> Vec<String> {
        let mut found: Vec<String> = match self {
            Store::Disk => std::fs::read_dir(
                data_dir
                    .join("blobs")
                    .join("snapshots")
                    .join(project.to_string()),
            )
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().to_string())
                    .filter(|name| !name.starts_with('.'))
                    .collect()
            })
            .unwrap_or_default(),
            Store::Bucket(bucket) => {
                let folder = format!("{PREFIX}/snapshots/{project}/");
                bucket
                    .keys()
                    .into_iter()
                    .filter_map(|key| key.strip_prefix(&folder).map(str::to_string))
                    .collect()
            }
        };
        found.sort();
        found
    }
}

struct Site {
    stage: Stage,
    data: tempfile::TempDir,
}

impl Site {
    async fn start(store: &Store) -> Site {
        let data = tempfile::tempdir().expect("data folder");
        let stage = stage_with(store.config(data.path())).await;
        Site { stage, data }
    }

    fn data(&self) -> &Path {
        self.data.path()
    }

    async fn share(&self, title: &str) -> SharedProjectId {
        share_project(&self.stage.server, &self.stage.bob, title)
            .await
            .project_id
    }

    async fn token(&self) -> String {
        let person: &Person = &self.stage.bob;
        let (account, device) = (person.tokens.account_id, person.tokens.device_id);
        let now = self.stage.server.clock().now_ms();
        self.stage
            .server
            .state()
            .db
            .call(move |conn| {
                oleafly_server::tokens::issue_access_token(conn, account, device, now)
            })
            .await
            .expect("an access token")
            .0
    }

    async fn upload(&self, project: SharedProjectId, bytes: &[u8]) -> String {
        let hash = sha256_hex(bytes);
        let response = put_bytes(
            &self.stage.server,
            &format!("/api/v1/projects/{project}/blobs/{hash}"),
            &self.token().await,
            bytes.to_vec(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        hash
    }

    async fn fetch(&self, project: SharedProjectId, hash: &str) -> StatusCode {
        call(
            &self.stage.server,
            Method::GET,
            &format!("/api/v1/projects/{project}/blobs/{hash}"),
            &self.token().await,
            None,
        )
        .await
        .status()
    }

    async fn append(&self, project: SharedProjectId, doc: &LoroDoc, change: impl FnOnce(&LoroDoc)) {
        let person: &Person = &self.stage.bob;
        let (device, account) = (person.tokens.device_id, person.tokens.account_id);
        let before = doc.oplog_vv();
        change(doc);
        doc.commit();
        let update = doc.export(ExportMode::updates(&before)).expect("update");
        let envelope = signed_by(person, &person.device, project, &update);
        let batch = envelope.batch_id;
        let stored = serde_json::to_vec(&envelope).expect("json");
        self.stage
            .server
            .state()
            .db
            .call(move |conn| {
                let reach = oleafly_server::peers::update_reach(&update).expect("a change");
                oleafly_server::peers::bind(conn, project, device, account, &reach, 1)?;
                projects::append_update(conn, project, batch, device, account, &stored, 1)?;
                Ok(())
            })
            .await
            .expect("append a change");
    }

    async fn add_file(
        &self,
        project: SharedProjectId,
        doc: &LoroDoc,
        name: &str,
        hash: &str,
    ) -> TreeID {
        let mut created = None;
        self.append(project, doc, |doc| {
            let tree = doc.get_tree("tree");
            tree.enable_fractional_index(0);
            let node = tree.create(TreeParentId::Root).expect("a node");
            let meta = tree.get_meta(node).expect("meta");
            meta.insert("id", name).expect("id");
            meta.insert("name", name).expect("name");
            meta.insert("kind", "blob").expect("kind");
            meta.insert("blob", hash).expect("blob");
            created = Some(node);
        })
        .await;
        created.expect("the node was made")
    }

    async fn replace_file(
        &self,
        project: SharedProjectId,
        doc: &LoroDoc,
        node: TreeID,
        hash: &str,
    ) {
        self.append(project, doc, |doc| {
            doc.get_tree("tree")
                .get_meta(node)
                .expect("meta")
                .insert("blob", hash)
                .expect("blob");
        })
        .await;
    }

    async fn delete_file(&self, project: SharedProjectId, doc: &LoroDoc, node: TreeID) {
        self.append(project, doc, |doc| {
            doc.get_tree("tree").delete(node).expect("delete");
        })
        .await;
    }

    fn later(&self, ms: i64) {
        self.stage.server.clock().advance(ms);
    }

    async fn maintain(&self) {
        self.stage
            .server
            .state()
            .run_maintenance()
            .await
            .expect("maintenance finishes");
    }

    async fn pending_removals(&self) -> i64 {
        self.stage
            .server
            .state()
            .db
            .call(|conn| {
                Ok(
                    conn.query_row("SELECT COUNT(*) FROM pending_removals", [], |row| {
                        row.get::<_, i64>(0)
                    })?,
                )
            })
            .await
            .expect("count")
    }
}

fn opened() -> LoroDoc {
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    doc
}

#[tokio::test]
async fn files_a_project_stopped_using_are_removed_after_the_grace_period() {
    for store in Store::both().await {
        let site = Site::start(&store).await;
        let project = site.share("Thesis").await;
        let doc = opened();
        let first = site.upload(project, b"first figure").await;
        let second = site.upload(project, b"second figure").await;
        let gone = site.upload(project, b"deleted table").await;
        let figure = site.add_file(project, &doc, "figure.png", &first).await;
        let table = site.add_file(project, &doc, "table.pdf", &gone).await;
        site.replace_file(project, &doc, figure, &second).await;
        site.delete_file(project, &doc, table).await;

        site.later(UNUSED_FILE_GRACE_MS + DAY_MS);
        let fresh = site.upload(project, b"uploaded just now").await;
        site.maintain().await;
        assert_eq!(site.fetch(project, &first).await, StatusCode::NOT_FOUND);
        assert_eq!(site.fetch(project, &gone).await, StatusCode::NOT_FOUND);
        assert!(!store.holds_file(site.data(), &first));
        assert!(!store.holds_file(site.data(), &gone));
        assert_eq!(site.fetch(project, &second).await, StatusCode::OK);
        assert_eq!(
            site.fetch(project, &fresh).await,
            StatusCode::OK,
            "a file whose change has not arrived yet stays through the grace period"
        );

        site.later(UNUSED_FILE_GRACE_MS + DAY_MS);
        site.maintain().await;
        assert_eq!(site.fetch(project, &fresh).await, StatusCode::NOT_FOUND);
        assert!(!store.holds_file(site.data(), &fresh));
        assert_eq!(site.fetch(project, &second).await, StatusCode::OK);
        assert!(store.holds_file(site.data(), &second));
        assert_eq!(site.pending_removals().await, 0);
    }
}

#[tokio::test]
async fn a_file_another_project_still_uses_keeps_its_bytes() {
    let store = Store::Disk;
    let site = Site::start(&store).await;
    let thesis = site.share("Thesis").await;
    let poster = site.share("Poster").await;
    let (thesis_doc, poster_doc) = (opened(), opened());
    let shared = site.upload(thesis, b"shared logo").await;
    assert_eq!(site.upload(poster, b"shared logo").await, shared);
    let replacement = site.upload(thesis, b"new logo").await;
    let logo = site
        .add_file(thesis, &thesis_doc, "logo.png", &shared)
        .await;
    site.add_file(poster, &poster_doc, "logo.png", &shared)
        .await;
    site.replace_file(thesis, &thesis_doc, logo, &replacement)
        .await;

    site.later(UNUSED_FILE_GRACE_MS + DAY_MS);
    site.maintain().await;
    assert_eq!(site.fetch(thesis, &shared).await, StatusCode::NOT_FOUND);
    assert_eq!(site.fetch(poster, &shared).await, StatusCode::OK);
    assert!(store.holds_file(site.data(), &shared));
}

#[tokio::test]
async fn a_file_uploaded_again_while_the_sweep_runs_is_kept() {
    let store = Store::Disk;
    let site = Site::start(&store).await;
    let project = site.share("Thesis").await;
    let doc = opened();
    let old = site.upload(project, b"old figure").await;
    let new = site.upload(project, b"new figure").await;
    let figure = site.add_file(project, &doc, "figure.png", &old).await;
    site.replace_file(project, &doc, figure, &new).await;
    site.later(UNUSED_FILE_GRACE_MS + DAY_MS);

    let state = site.stage.server.state();
    let now = site.stage.server.clock().now_ms();
    let unused = cleanup::unused_files(&state.db, &state.snapshots, now)
        .await
        .expect("the mark pass");
    assert_eq!(unused.len(), 1);
    assert_eq!(site.upload(project, b"old figure").await, old);
    cleanup::remove_unused_files(&state.db, &state.blobs, unused, now)
        .await
        .expect("the sweep");
    assert_eq!(site.fetch(project, &old).await, StatusCode::OK);
    assert!(store.holds_file(site.data(), &old));
}

#[tokio::test]
async fn an_expired_project_is_cleared_out_once_the_bucket_answers_again() {
    let store = Store::Bucket(MockS3::start().await);
    let site = Site::start(&store).await;
    let project = site.share("Old thesis").await;
    let figure = site.upload(project, b"figure of an old thesis").await;
    let archived = call(
        &site.stage.server,
        Method::POST,
        &format!("/api/v1/projects/{project}/archive"),
        site.stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    assert_eq!(store.snapshot_objects(site.data(), project).len(), 1);
    site.later(31 * DAY_MS);

    store.bucket().set_fault(Some(MockS3Fault::Unavailable));
    let report = site
        .stage
        .server
        .state()
        .run_maintenance()
        .await
        .expect("the pass finishes while the bucket is down");
    assert_eq!(report.expired_projects, 1);
    assert!(store.holds_file(site.data(), &figure));
    assert_eq!(store.snapshot_objects(site.data(), project).len(), 1);
    assert_eq!(site.pending_removals().await, 2);

    store.bucket().set_fault(None);
    site.maintain().await;
    assert!(!store.holds_file(site.data(), &figure));
    assert!(store.snapshot_objects(site.data(), project).is_empty());
    assert_eq!(site.pending_removals().await, 0);
}

#[tokio::test]
async fn snapshots_left_behind_by_a_failed_delete_are_removed_later() {
    let store = Store::Bucket(MockS3::start().await);
    let site = Site::start(&store).await;
    site.stage.server.state().snapshots.set_policy(Policy {
        build_after: 1,
        keep_updates: 1,
    });
    let project = site.share("Thesis").await;
    let doc = opened();
    store.bucket().set_fault(Some(MockS3Fault::RefuseDeletes));
    for round in 1..=4u64 {
        site.append(project, &doc, |doc| {
            let text = doc.get_text("text");
            text.insert(text.len_unicode(), &format!(" {round}"))
                .expect("insert");
        })
        .await;
        let hinted = put_bytes(
            &site.stage.server,
            &format!("/api/v1/projects/{project}/snapshot?seq={round}"),
            site.stage.bob.token(),
            Vec::new(),
        )
        .await;
        assert_eq!(hinted.status(), StatusCode::NO_CONTENT);
    }
    let rows = site
        .stage
        .server
        .state()
        .db
        .call(move |conn| projects::snapshots(conn, project))
        .await
        .expect("rows");
    let kept: Vec<String> = {
        let mut kept: Vec<String> = rows.iter().filter_map(|row| row.hash.clone()).collect();
        kept.sort();
        kept
    };
    assert!(store.snapshot_objects(site.data(), project).len() > kept.len());
    assert!(site.pending_removals().await > 0);

    store.bucket().set_fault(None);
    site.maintain().await;
    assert_eq!(store.snapshot_objects(site.data(), project), kept);
    assert_eq!(site.pending_removals().await, 0);
    for row in rows {
        let hash = row.hash.expect("a hash");
        assert_eq!(row.file, snapshot_key(project, &hash));
    }
}

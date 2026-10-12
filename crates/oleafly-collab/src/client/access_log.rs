use oleafly_collab_protocol::access_log::AccessEntry;
use oleafly_collab_protocol::admin::Page;
use oleafly_collab_protocol::ids::SharedProjectId;

use super::http::json;
use super::ServerClient;
use crate::CollabError;

impl ServerClient {
    pub async fn access_log(
        &self,
        access: &str,
        project: SharedProjectId,
        cursor: Option<&str>,
    ) -> Result<Page<AccessEntry>, CollabError> {
        let mut url = self.url().endpoint("api/v1/projects");
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push(&project.to_string());
            segments.push("access-log");
        }
        if let Some(cursor) = cursor.filter(|cursor| !cursor.is_empty()) {
            url.query_pairs_mut().append_pair("cursor", cursor);
        }
        json(self.http().get(url).bearer_auth(access)).await
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::access_log::{AccessKind, JoinedVia};
    use oleafly_collab_protocol::ids::SharedProjectId;
    use oleafly_collab_protocol::projects::{ProjectPatch, ProjectStatus};
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::access_log::{self, Visit};
    use oleafly_server::projects;
    use oleafly_server::test_support::{test_config, SeededMember, TestServer};

    use crate::client::test_util::{seed, server_url};
    use crate::client::ServerClient;
    use crate::CollabError;

    async fn owned_project(server: &TestServer, owner: &SeededMember) -> SharedProjectId {
        let owner = owner.account_id;
        server
            .state()
            .db
            .call(move |conn| {
                let id = projects::create_pending(conn, owner, "Thesis", 1)?;
                projects::set_status(conn, id, ProjectStatus::Active, 1)?;
                Ok(id)
            })
            .await
            .expect("project")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_owner_turns_the_log_on_and_pages_through_it() {
        let server = TestServer::start(test_config()).await;
        let owner = seed(&server, ServerRole::Admin).await;
        let other = seed(&server, ServerRole::Member).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        let project = owned_project(&server, &owner).await;
        let summary = client
            .patch_project(
                &owner.access_token,
                project,
                &ProjectPatch {
                    access_log: Some(true),
                    ..ProjectPatch::default()
                },
            )
            .await
            .expect("turned on");
        assert!(summary.access_log);
        let (account, device) = (other.account_id, other.device_id);
        server
            .state()
            .db
            .call(move |conn| {
                for at in 1..=3 {
                    access_log::record(
                        conn,
                        at,
                        Visit::joined(project, account, device, JoinedVia::Share),
                    )?;
                }
                Ok(())
            })
            .await
            .expect("entries");
        let first = client
            .access_log(&owner.access_token, project, None)
            .await
            .expect("first page");
        assert_eq!(first.items.len(), 3);
        assert_eq!(first.items[0].at, 3);
        assert_eq!(first.items[0].kind, AccessKind::Joined);
        assert_eq!(first.items[0].person.account_id, other.account_id);
        assert_eq!(first.next_cursor, None);
        let older = client
            .access_log(
                &owner.access_token,
                project,
                Some(&first.items[1].id.to_string()),
            )
            .await
            .expect("older page");
        assert_eq!(older.items.len(), 1);
        assert_eq!(older.items[0].at, 1);
        assert!(matches!(
            client.access_log(&other.access_token, project, None).await,
            Err(CollabError::Api { status: 404, .. })
        ));
    }
}

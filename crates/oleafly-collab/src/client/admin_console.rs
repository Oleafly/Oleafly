use oleafly_collab_protocol::console::{
    AdminOverview, AdminProject, AdminProjectsPage, AdminProjectsQuery,
};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectStatus;

use super::http::json;
use super::ServerClient;
use crate::CollabError;

fn status_name(status: ProjectStatus) -> Option<&'static str> {
    match status {
        ProjectStatus::Active => Some("active"),
        ProjectStatus::Archived => Some("archived"),
        ProjectStatus::Pending => Some("pending"),
        ProjectStatus::Unknown => None,
    }
}

impl ServerClient {
    pub async fn admin_overview(&self, access: &str) -> Result<AdminOverview, CollabError> {
        json(
            self.http()
                .get(self.url().endpoint("api/v1/admin/overview"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_projects(
        &self,
        access: &str,
        query: &AdminProjectsQuery,
    ) -> Result<AdminProjectsPage, CollabError> {
        let mut url = self.url().endpoint("api/v1/admin/projects");
        {
            let mut pairs = url.query_pairs_mut();
            if let Some(q) = query.q.as_deref().filter(|q| !q.trim().is_empty()) {
                pairs.append_pair("q", q);
            }
            if let Some(status) = query.status.and_then(status_name) {
                pairs.append_pair("status", status);
            }
            if let Some(sort) = query.sort {
                pairs.append_pair("sort", sort.as_str());
            }
            if let Some(order) = query.order {
                pairs.append_pair("order", order.as_str());
            }
            if let Some(cursor) = query.cursor.as_deref() {
                pairs.append_pair("cursor", cursor);
            }
            if let Some(limit) = query.limit {
                pairs.append_pair("limit", &limit.to_string());
            }
        }
        if url.query() == Some("") {
            url.set_query(None);
        }
        json(self.http().get(url).bearer_auth(access)).await
    }

    fn admin_project_url(&self, project: SharedProjectId, action: &str) -> ::url::Url {
        let mut url = self.url().endpoint("api/v1/admin/projects");
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push(&project.to_string());
            segments.push(action);
        }
        url
    }

    pub async fn admin_archive_project(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<AdminProject, CollabError> {
        json(
            self.http()
                .post(self.admin_project_url(project, "archive"))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_unarchive_project(
        &self,
        access: &str,
        project: SharedProjectId,
    ) -> Result<AdminProject, CollabError> {
        json(
            self.http()
                .post(self.admin_project_url(project, "unarchive"))
                .bearer_auth(access),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::console::{
        AdminProjectSort, AdminProjectsQuery, FilesLocation, SortOrder,
    };
    use oleafly_collab_protocol::ids::SharedProjectId;
    use oleafly_collab_protocol::projects::ProjectStatus;
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::projects;
    use oleafly_server::test_support::{test_config, SeededMember, TestServer};

    use crate::client::test_util::{seed, server_url};
    use crate::client::ServerClient;
    use crate::CollabError;

    async fn console() -> (TestServer, ServerClient, SeededMember, SeededMember) {
        let server = TestServer::start(test_config()).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let member = seed(&server, ServerRole::Member).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        (server, client, admin, member)
    }

    async fn shared(
        server: &TestServer,
        owner: &SeededMember,
        title: &'static str,
    ) -> SharedProjectId {
        let owner = owner.account_id;
        server
            .state()
            .db
            .call(move |conn| {
                let id = projects::create_pending(conn, owner, title, 1)?;
                projects::record_snapshot(conn, id, 0, "snapshots/test.bin", 10, owner, 1)?;
                projects::set_status(conn, id, ProjectStatus::Active, 1)?;
                Ok(id)
            })
            .await
            .expect("project")
    }

    fn forbidden<T: std::fmt::Debug>(result: Result<T, CollabError>) -> bool {
        matches!(result, Err(CollabError::Api { status: 403, .. }))
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admins_read_the_overview_and_members_are_refused() {
        let (_server, client, admin, member) = console().await;
        let overview = client
            .admin_overview(&admin.access_token)
            .await
            .expect("overview");
        assert_eq!(overview.counts.people, 2);
        assert_eq!(
            overview.storage.expect("storage").files_location,
            FilesLocation::Disk
        );
        assert!(forbidden(client.admin_overview(&member.access_token).await));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_projects_query_reaches_the_server() {
        let (server, client, admin, member) = console().await;
        shared(&server, &admin, "Alpha").await;
        shared(&server, &admin, "Beta").await;
        shared(&server, &admin, "Gamma").await;
        let first = client
            .admin_projects(
                &admin.access_token,
                &AdminProjectsQuery {
                    q: Some("a".to_string()),
                    status: Some(ProjectStatus::Active),
                    sort: Some(AdminProjectSort::Title),
                    order: Some(SortOrder::Desc),
                    cursor: None,
                    limit: Some(2),
                },
            )
            .await
            .expect("first page");
        let titles: Vec<&str> = first.items.iter().map(|item| item.title.as_str()).collect();
        assert_eq!(titles, vec!["Gamma", "Beta"]);
        assert_eq!(first.total, 3);
        let rest = client
            .admin_projects(
                &admin.access_token,
                &AdminProjectsQuery {
                    q: Some("a".to_string()),
                    sort: Some(AdminProjectSort::Title),
                    order: Some(SortOrder::Desc),
                    cursor: first.next_cursor.clone(),
                    limit: Some(2),
                    ..AdminProjectsQuery::default()
                },
            )
            .await
            .expect("second page");
        assert_eq!(rest.items[0].title, "Alpha");
        assert_eq!(rest.next_cursor, None);
        let everything = client
            .admin_projects(&admin.access_token, &AdminProjectsQuery::default())
            .await
            .expect("default page");
        assert_eq!(everything.total, 3);
        let searched = client
            .admin_projects(
                &admin.access_token,
                &AdminProjectsQuery {
                    q: Some("AMM".to_string()),
                    ..AdminProjectsQuery::default()
                },
            )
            .await
            .expect("search");
        assert_eq!(searched.total, 1);
        assert_eq!(searched.items[0].title, "Gamma");
        assert!(forbidden(
            client
                .admin_projects(&member.access_token, &AdminProjectsQuery::default())
                .await
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn admins_archive_and_restore_a_project() {
        let (server, client, admin, member) = console().await;
        let project = shared(&server, &member, "Thesis").await;
        let archived = client
            .admin_archive_project(&admin.access_token, project)
            .await
            .expect("archive");
        assert_eq!(archived.status, ProjectStatus::Archived);
        let restored = client
            .admin_unarchive_project(&admin.access_token, project)
            .await
            .expect("unarchive");
        assert_eq!(restored.status, ProjectStatus::Active);
        assert!(forbidden(
            client
                .admin_archive_project(&member.access_token, project)
                .await
        ));
        assert!(matches!(
            client
                .admin_unarchive_project(&admin.access_token, SharedProjectId::new_v7())
                .await,
            Err(CollabError::Api { status: 404, .. })
        ));
    }
}

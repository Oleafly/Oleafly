use oleafly_collab_protocol::published::{
    AdminPublishedNote, PublishNote, PublishedNote, PublishedNotes,
};

use super::http::{empty, json, transfer_timeout};
use super::ServerClient;
use crate::CollabError;

const COLLECTION: &str = "api/v1/published-notes";
const ADMIN_COLLECTION: &str = "api/v1/admin/published-notes";

impl ServerClient {
    pub async fn published_notes(&self, access: &str) -> Result<PublishedNotes, CollabError> {
        json(
            self.http()
                .get(self.url().endpoint(COLLECTION))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn publish_note(
        &self,
        access: &str,
        note: &PublishNote,
    ) -> Result<PublishedNote, CollabError> {
        json(
            self.http()
                .post(self.url().endpoint(COLLECTION))
                .bearer_auth(access)
                .timeout(transfer_timeout(note.html.len() as u64))
                .json(note),
        )
        .await
    }

    pub async fn unpublish_note(&self, access: &str, id: &str) -> Result<(), CollabError> {
        let mut url = self.url().endpoint(COLLECTION);
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push(id);
        }
        empty(self.http().delete(url).bearer_auth(access)).await
    }

    pub async fn admin_published_notes(
        &self,
        access: &str,
    ) -> Result<Vec<AdminPublishedNote>, CollabError> {
        json(
            self.http()
                .get(self.url().endpoint(ADMIN_COLLECTION))
                .bearer_auth(access),
        )
        .await
    }

    pub async fn admin_set_note_taken_down(
        &self,
        access: &str,
        id: &str,
        down: bool,
    ) -> Result<AdminPublishedNote, CollabError> {
        let mut url = self.url().endpoint(ADMIN_COLLECTION);
        if let Ok(mut segments) = url.path_segments_mut() {
            segments.push(id);
            segments.push(if down { "take-down" } else { "restore" });
        }
        json(self.http().post(url).bearer_auth(access)).await
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
    use oleafly_collab_protocol::published::PublishNote;
    use oleafly_collab_protocol::roles::ServerRole;
    use oleafly_server::test_support::{test_config, TestServer};

    use crate::client::test_util::{seed, server_url};
    use crate::client::ServerClient;
    use crate::CollabError;

    fn note(html: &str) -> PublishNote {
        PublishNote {
            source: "note-1".to_string(),
            title: "Field notes".to_string(),
            html: html.to_string(),
        }
    }

    #[tokio::test]
    async fn a_member_publishes_lists_and_unpublishes_once_the_admin_allows_it() {
        let server = TestServer::start(test_config()).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let member = seed(&server, ServerRole::Member).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        let access = member.access_token.as_str();

        let off = client.publish_note(access, &note("<p>x</p>")).await;
        assert!(
            matches!(&off, Err(CollabError::Api { code, .. }) if code == "public_notes_off"),
            "{off:?}"
        );
        assert!(!client.published_notes(access).await.expect("list").allowed);

        client
            .admin_patch_settings(
                &admin.access_token,
                &RuntimeSettingsPatch {
                    public_notes_allowed: Some(true),
                    ..RuntimeSettingsPatch::default()
                },
            )
            .await
            .expect("turned on");
        let published = client
            .publish_note(access, &note("<p>Hello<script>x()</script></p>"))
            .await
            .expect("published");
        let page = reqwest::get(&published.url).await.expect("page");
        assert_eq!(page.status(), 200);
        let html = page.text().await.expect("html");
        assert!(html.contains("<p>Hello</p>"));
        assert!(!html.contains("script"));

        let listed = client.published_notes(access).await.expect("list");
        assert!(listed.allowed);
        assert_eq!(listed.notes, vec![published.clone()]);

        client
            .unpublish_note(access, &published.id)
            .await
            .expect("unpublished");
        assert!(client
            .published_notes(access)
            .await
            .expect("list")
            .notes
            .is_empty());
        assert_eq!(
            reqwest::get(&published.url).await.expect("page").status(),
            404
        );
    }

    #[tokio::test]
    async fn an_admin_takes_a_page_down_and_puts_it_back() {
        let server = TestServer::start(test_config()).await;
        let admin = seed(&server, ServerRole::Admin).await;
        let member = seed(&server, ServerRole::Member).await;
        let client = ServerClient::new(server_url(&server)).expect("client");
        client
            .admin_patch_settings(
                &admin.access_token,
                &RuntimeSettingsPatch {
                    public_notes_allowed: Some(true),
                    ..RuntimeSettingsPatch::default()
                },
            )
            .await
            .expect("turned on");
        let published = client
            .publish_note(&member.access_token, &note("<p>Hi</p>"))
            .await
            .expect("published");
        let listed = client
            .admin_published_notes(&admin.access_token)
            .await
            .expect("admin list");
        assert_eq!(listed[0].note.id, published.id);
        assert_eq!(
            listed[0].author.as_ref().map(|person| person.account_id),
            Some(member.account_id)
        );
        let down = client
            .admin_set_note_taken_down(&admin.access_token, &published.id, true)
            .await
            .expect("taken down");
        assert!(down.note.taken_down);
        assert_eq!(
            reqwest::get(&published.url).await.expect("page").status(),
            404
        );
        let back = client
            .admin_set_note_taken_down(&admin.access_token, &published.id, false)
            .await
            .expect("restored");
        assert!(!back.note.taken_down);
        let refused = client.admin_published_notes(&member.access_token).await;
        assert!(
            matches!(refused, Err(CollabError::Api { status: 403, .. })),
            "{refused:?}"
        );
    }
}

use loro::{EncodedBlobMode, LoroDoc};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectDevice;

use crate::client::SnapshotDownload;
use crate::devices::{DeviceRegistry, Verdict};
use crate::{CollabError, ServerClient};

const ATTEMPTS: usize = 3;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verified {
    pub seq: u64,
    pub bytes: Vec<u8>,
    pub listed: Option<Vec<ProjectDevice>>,
}

pub fn loads(bytes: &[u8]) -> bool {
    LoroDoc::decode_import_blob_meta(bytes, true)
        .is_ok_and(|meta| meta.mode == EncodedBlobMode::Snapshot)
}

pub async fn fetch_verified(
    client: &ServerClient,
    access: &str,
    project: SharedProjectId,
    pinned: &DeviceRegistry,
) -> Result<Verified, CollabError> {
    let mut registry = pinned.clone();
    let mut listed: Option<Vec<ProjectDevice>> = None;
    let mut before = None;
    for _ in 0..ATTEMPTS {
        let download = client.download_snapshot(access, project, before).await?;
        if before.is_some_and(|before| download.seq >= before) {
            break;
        }
        if trusted(
            client,
            access,
            project,
            &download,
            &mut registry,
            &mut listed,
        )
        .await?
        {
            return Ok(Verified {
                seq: download.seq,
                bytes: download.bytes,
                listed,
            });
        }
        if download.seq == 0 {
            break;
        }
        before = Some(download.seq);
    }
    Err(CollabError::Corrupt(
        "no snapshot of this project could be checked and loaded".to_owned(),
    ))
}

async fn trusted(
    client: &ServerClient,
    access: &str,
    project: SharedProjectId,
    download: &SnapshotDownload,
    registry: &mut DeviceRegistry,
    listed: &mut Option<Vec<ProjectDevice>>,
) -> Result<bool, CollabError> {
    if !loads(&download.bytes) {
        return Ok(false);
    }
    let Some(signed) = &download.signed else {
        return Ok(true);
    };
    let verdict = |registry: &DeviceRegistry| {
        registry.verify_snapshot(
            project,
            download.seq,
            &download.bytes,
            signed.device_id,
            &signed.signature,
        )
    };
    match verdict(registry) {
        Verdict::Signed(_) => Ok(true),
        Verdict::Forged => Ok(false),
        Verdict::Unknown => {
            if listed.is_none() {
                let devices = client.project_devices(access, project).await?;
                registry.pin(devices.clone());
                *listed = Some(devices);
            }
            Ok(matches!(verdict(registry), Verdict::Signed(_)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::test_util::{device_key, two_people, Pair};
    use crate::doc::{NodeKind, ProjectDoc};
    use oleafly_collab_protocol::projects::ProjectRole;

    async fn shared(pair: &Pair) -> (ServerClient, SharedProjectId, Vec<u8>) {
        let client = ServerClient::new(pair.url.clone()).unwrap();
        let bob = &pair.bob.tokens.access_token;
        let mut doc = ProjectDoc::create().unwrap();
        doc.add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let snapshot = doc.snapshot().unwrap();
        let project = client
            .create_project(bob, "Thesis")
            .await
            .unwrap()
            .project_id;
        client
            .put_first_snapshot(bob, project, snapshot.clone(), &pair.bob.key)
            .await
            .unwrap();
        client.commit_project(bob, project).await.unwrap();
        client
            .grant_member(
                bob,
                project,
                pair.alice.tokens.account_id,
                ProjectRole::Editor,
            )
            .await
            .unwrap();
        (client, project, snapshot)
    }

    async fn set_signature(pair: &Pair, project: SharedProjectId, signature: Option<String>) {
        pair._server
            .state()
            .db
            .call(move |conn| {
                conn.execute(
                    "UPDATE project_snapshots SET signature = ?2, signed_by = CASE WHEN ?2 IS NULL THEN NULL ELSE signed_by END WHERE project_id = ?1",
                    (project.to_string(), signature),
                )?;
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_first_snapshot_is_checked_against_the_owners_device() {
        let pair = two_people().await;
        let (client, project, snapshot) = shared(&pair).await;
        let alice = &pair.alice.tokens.access_token;
        let verified = fetch_verified(&client, alice, project, &DeviceRegistry::default())
            .await
            .unwrap();
        assert_eq!(verified.seq, 0);
        assert_eq!(verified.bytes, snapshot);
        let listed = verified.listed.expect("the signing device was looked up");
        assert!(listed
            .iter()
            .any(|device| device.device_id == pair.bob.tokens.device_id));
        let mut pinned = DeviceRegistry::default();
        pinned.pin(listed);
        let again = fetch_verified(&client, alice, project, &pinned)
            .await
            .unwrap();
        assert_eq!(again.listed, None);

        let digest = ring::digest::digest(&ring::digest::SHA256, &snapshot);
        let forged =
            device_key().sign_b64(&oleafly_collab_protocol::snapshots::snapshot_signing_bytes(
                project,
                0,
                digest.as_ref(),
            ));
        set_signature(&pair, project, Some(forged)).await;
        assert!(fetch_verified(&client, alice, project, &pinned)
            .await
            .is_err());

        set_signature(&pair, project, None).await;
        let unsigned = fetch_verified(&client, alice, project, &pinned)
            .await
            .unwrap();
        assert_eq!(unsigned.bytes, snapshot);
    }
}

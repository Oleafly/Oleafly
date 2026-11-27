use std::path::PathBuf;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use oleafly_collab::sync::LiveLink;

pub(super) use oleafly_live::live::downloads::*;

use super::session::{Active, LiveDisk};
use super::unwritten::UnwrittenReason;
use crate::collab::commands::with_access;
use crate::collab::disk::sha256_hex;

impl FigureHost for Active {
    fn local(&self) -> &LiveDisk {
        &self.local
    }

    fn figure_hold_dir(&self) -> PathBuf {
        self.hold_dir()
    }

    fn fetch_figure(&self, _path: &str, hash: &str) -> BoxFuture<'static, Option<Vec<u8>>> {
        let (link, hash) = (self.link.clone(), hash.to_owned());
        Box::pin(async move { fetch(&link, &hash).await })
    }

    fn figure_conflict(
        self: Arc<Self>,
        path: String,
        _bytes: Bytes,
    ) -> BoxFuture<'static, Option<UnwrittenReason>> {
        Box::pin(async move {
            if let Err(error) = self.import_paths(Some(vec![path.clone()])).await {
                self.local.log_once("figure conflict", || {
                    format!("could not send the local version of {path}: {error}")
                });
            }
            None
        })
    }
}

async fn fetch(link: &LiveLink, hash: &str) -> Option<Vec<u8>> {
    let project = link.project;
    with_access(
        &link.sessions,
        link.server_id,
        &link.client,
        |client, access| {
            let hash = hash.to_owned();
            Box::pin(async move { client.get_blob(access, project, &hash).await })
        },
    )
    .await
    .ok()
    .filter(|bytes| sha256_hex(bytes) == hash)
}

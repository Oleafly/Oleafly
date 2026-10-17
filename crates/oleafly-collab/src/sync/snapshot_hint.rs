use super::{lock, LiveLink, SharedLive};

const SNAPSHOT_EVERY: u64 = 1_000;

pub(super) fn should_snapshot(acknowledged: u64) -> bool {
    acknowledged > 0 && acknowledged.is_multiple_of(SNAPSHOT_EVERY)
}

fn snapshot_needed(held: Option<u64>, seq: u64) -> bool {
    held.is_none_or(|held| held < seq)
}

pub(super) fn hint_snapshot(link: &LiveLink, project: &SharedLive) {
    let seq = {
        let live = lock(project);
        if !live.can_edit() {
            return;
        }
        live.last_seq()
    };
    let link = link.clone();
    tokio::spawn(async move {
        if let Ok(access) = link
            .sessions
            .access_token(link.server_id, &link.client)
            .await
        {
            let held = link.client.snapshot_seq(&access, link.project).await;
            if held.is_ok_and(|held| !snapshot_needed(held, seq)) {
                return;
            }
            let _ = link.client.snapshot_hint(&access, link.project, seq).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_change_that_lands_on_the_interval_uploads_a_snapshot() {
        assert!(!should_snapshot(0));
        assert!(!should_snapshot(SNAPSHOT_EVERY - 1));
        assert!(should_snapshot(SNAPSHOT_EVERY));
        assert!(!should_snapshot(SNAPSHOT_EVERY + 1));
        assert!(should_snapshot(SNAPSHOT_EVERY * 3));
        assert_eq!(SNAPSHOT_EVERY, 1_000);
    }

    #[test]
    fn a_snapshot_the_server_already_holds_is_not_sent_again() {
        assert!(snapshot_needed(None, 0));
        assert!(snapshot_needed(Some(999), 1_000));
        assert!(!snapshot_needed(Some(1_000), 1_000));
        assert!(!snapshot_needed(Some(2_000), 1_000));
    }
}

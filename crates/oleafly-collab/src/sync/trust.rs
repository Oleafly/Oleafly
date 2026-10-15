use std::collections::BTreeSet;

use oleafly_collab_protocol::crypto::verify_ed25519;
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use tokio::sync::mpsc::UnboundedSender;

use super::{lock, LiveEvent, LiveLink, SharedLive};
use crate::devices::Verdict;
use crate::live::PeerCheck;

pub(super) enum Trust {
    Signed(Option<AccountId>),
    Refused,
    Unreadable,
    Unreachable,
}

#[derive(Default)]
pub(super) struct Refreshed {
    devices: BTreeSet<DeviceId>,
    peers: BTreeSet<u64>,
}

pub(super) async fn trust(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    refreshed: &mut Refreshed,
    envelope: &Envelope,
    claimed: Option<AccountId>,
) -> Trust {
    if envelope.mode == EnvelopeMode::Unknown {
        return Trust::Unreadable;
    }
    match signature_trust(
        link,
        project,
        events,
        &mut refreshed.devices,
        envelope,
        claimed,
    )
    .await
    {
        Trust::Signed(author) => {
            match peer_trust(link, project, &mut refreshed.peers, envelope).await {
                Trust::Signed(_) => Trust::Signed(author),
                other => other,
            }
        }
        other => other,
    }
}

pub(super) async fn peer_trust(
    link: &LiveLink,
    project: &SharedLive,
    refreshed: &mut BTreeSet<u64>,
    envelope: &Envelope,
) -> Trust {
    let unknown = match lock(project).check_peers(&envelope.payload, envelope.device_id) {
        PeerCheck::Fine => return Trust::Signed(None),
        PeerCheck::Refused => return Trust::Refused,
        PeerCheck::Unreadable => return Trust::Unreadable,
        PeerCheck::Unknown(unknown) => unknown,
    };
    if unknown.iter().all(|peer| refreshed.contains(peer)) {
        return Trust::Signed(None);
    }
    refreshed.extend(unknown.iter().copied());
    // Once the whole list has been seen, a new writer id only needs its own
    // row, not every row the project ever had.
    let whole = !lock(project).peers_vouched();
    let listed = match link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
    {
        Ok(access) if whole => link.client.project_peers(&access, link.project).await,
        Ok(access) => {
            link.client
                .project_peers_among(&access, link.project, &unknown)
                .await
        }
        Err(error) => Err(error),
    };
    match listed {
        Ok(listed) => {
            let mut live = lock(project);
            if whole {
                live.pin_peers(listed);
            } else {
                live.add_peers(listed);
            }
            match live.check_peers(&envelope.payload, envelope.device_id) {
                PeerCheck::Refused => Trust::Refused,
                PeerCheck::Unreadable => Trust::Unreadable,
                PeerCheck::Fine | PeerCheck::Unknown(_) => Trust::Signed(None),
            }
        }
        Err(_) => Trust::Unreachable,
    }
}

async fn signature_trust(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    refreshed: &mut BTreeSet<DeviceId>,
    envelope: &Envelope,
    claimed: Option<AccountId>,
) -> Trust {
    if envelope.project_id != link.project {
        return Trust::Refused;
    }
    if envelope.device_id == link.device_id {
        let own = verify_ed25519(
            &link.signing_key().public_key(),
            &envelope.signing_bytes(),
            &envelope.signature,
        );
        return if own {
            Trust::Signed(claimed)
        } else {
            Trust::Refused
        };
    }
    let verdict = lock(project).devices().verify(envelope, claimed);
    match verdict {
        Verdict::Signed(account) => return Trust::Signed(Some(account)),
        Verdict::Forged => return Trust::Refused,
        Verdict::Unknown if !refreshed.insert(envelope.device_id) => return Trust::Refused,
        Verdict::Unknown => {}
    }
    let listed = match link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
    {
        Ok(access) => link.client.project_devices(&access, link.project).await,
        Err(error) => Err(error),
    };
    let Ok(listed) = listed else {
        return Trust::Unreachable;
    };
    let (announced, verdict) = {
        let mut live = lock(project);
        let announced = live.pin_devices(listed);
        (announced, live.devices().verify(envelope, claimed))
    };
    for device in announced {
        let _ = events.send(LiveEvent::NewDevice {
            account_id: device.account_id,
            device_id: device.device_id,
        });
    }
    match verdict {
        Verdict::Signed(account) => Trust::Signed(Some(account)),
        Verdict::Unknown | Verdict::Forged => Trust::Refused,
    }
}

use serde::{Deserialize, Serialize};

use crate::ids::{AccountId, DeviceId, SharedProjectId};

const SIGNING_DOMAIN: &[u8] = b"oleafly-snapshot/v1\0";

pub const SNAPSHOT_DEVICE_HEADER: &str = "x-oleafly-snapshot-device";
pub const SNAPSHOT_SIGNATURE_HEADER: &str = "x-oleafly-snapshot-signature";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectPeer {
    pub peer: u64,
    pub device_id: DeviceId,
    pub account_id: AccountId,
}

pub fn snapshot_signing_bytes(project: SharedProjectId, seq: u64, sha256: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(SIGNING_DOMAIN.len() + 24 + sha256.len());
    bytes.extend_from_slice(SIGNING_DOMAIN);
    bytes.extend_from_slice(project.as_uuid().as_bytes());
    bytes.extend_from_slice(&seq.to_be_bytes());
    bytes.extend_from_slice(sha256);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: &str = "01920000-0000-7000-8000-000000000001";

    #[test]
    fn the_signed_bytes_cover_the_project_the_seq_and_the_hash() {
        let project: SharedProjectId = PROJECT.parse().unwrap();
        let other: SharedProjectId = "01920000-0000-7000-8000-000000000002".parse().unwrap();
        let base = snapshot_signing_bytes(project, 0, &[1; 32]);
        assert!(base.starts_with(b"oleafly-snapshot/v1\0"));
        assert_ne!(base, snapshot_signing_bytes(other, 0, &[1; 32]));
        assert_ne!(base, snapshot_signing_bytes(project, 1, &[1; 32]));
        assert_ne!(base, snapshot_signing_bytes(project, 0, &[2; 32]));
    }

    #[test]
    fn a_peer_reads_back_from_json_with_its_full_width() {
        let peer = ProjectPeer {
            peer: u64::MAX - 3,
            device_id: "01920000-0000-7000-8000-000000000003".parse().unwrap(),
            account_id: "01920000-0000-7000-8000-000000000004".parse().unwrap(),
        };
        let json = serde_json::to_string(&peer).unwrap();
        assert_eq!(serde_json::from_str::<ProjectPeer>(&json).unwrap(), peer);
    }
}

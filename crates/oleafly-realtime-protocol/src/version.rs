pub const REALTIME_PROTOCOL_VERSION: u16 = 1;
pub const AUTHORING_DOC_SCHEMA_VERSION: u16 = 1;
pub const CANONICAL_MANIFEST_SCHEMA_VERSION: u16 = 1;
pub const SUPPORTED_REALTIME_PROTOCOL_VERSIONS: &[u16] = &[REALTIME_PROTOCOL_VERSION];

pub fn negotiate_realtime_protocol_version(peer_versions: &[u16]) -> Option<u16> {
    negotiate_highest_common_version(SUPPORTED_REALTIME_PROTOCOL_VERSIONS, peer_versions)
}

pub fn negotiate_highest_common_version(
    local_versions: &[u16],
    peer_versions: &[u16],
) -> Option<u16> {
    local_versions
        .iter()
        .copied()
        .filter(|version| peer_versions.contains(version))
        .max()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiation_fails_closed() {
        assert_eq!(negotiate_realtime_protocol_version(&[2]), None);
        assert_eq!(negotiate_realtime_protocol_version(&[2, 1]), Some(1));
        assert_eq!(
            negotiate_highest_common_version(&[1, 2, 3], &[2, 3, 4]),
            Some(3)
        );
    }
}

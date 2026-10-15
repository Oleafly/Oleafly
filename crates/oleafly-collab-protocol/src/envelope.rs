use crate::crypto::b64url_bytes;
use crate::ids::{BatchId, DeviceId, SharedProjectId};
use serde::{Deserialize, Serialize};

const SIGNING_DOMAIN: &[u8] = b"oleafly-envelope/v1\0";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvelopeMode {
    Plain,
    E2ee,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub project_id: SharedProjectId,
    pub batch_id: BatchId,
    pub device_id: DeviceId,
    pub mode: EnvelopeMode,
    pub key_epoch: Option<u32>,
    #[serde(with = "b64url_bytes")]
    pub payload: Vec<u8>,
    #[serde(with = "b64url_bytes")]
    pub signature: Vec<u8>,
}

impl Envelope {
    pub fn signing_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(SIGNING_DOMAIN.len() + 66 + self.payload.len());
        bytes.extend_from_slice(SIGNING_DOMAIN);
        bytes.extend_from_slice(&self.v.to_be_bytes());
        bytes.extend_from_slice(self.project_id.as_uuid().as_bytes());
        bytes.extend_from_slice(self.batch_id.as_uuid().as_bytes());
        bytes.extend_from_slice(self.device_id.as_uuid().as_bytes());
        // A mode this build can't read has no known byte, so its signature
        // never checks out. Readers skip such an envelope before checking it.
        bytes.push(match self.mode {
            EnvelopeMode::Plain => 0,
            EnvelopeMode::E2ee => 1,
            EnvelopeMode::Unknown => u8::MAX,
        });
        match self.key_epoch {
            None => bytes.push(0),
            Some(epoch) => {
                bytes.push(1);
                bytes.extend_from_slice(&epoch.to_be_bytes());
            }
        }
        bytes.extend_from_slice(&(self.payload.len() as u64).to_be_bytes());
        bytes.extend_from_slice(&self.payload);
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::verify_ed25519;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    const PROJECT: &str = "01920000-0000-7000-8000-000000000001";
    const BATCH: &str = "01920000-0000-7000-8000-000000000002";
    const DEVICE: &str = "01920000-0000-7000-8000-000000000003";
    const OTHER: &str = "01920000-0000-7000-8000-000000000009";

    fn envelope() -> Envelope {
        Envelope {
            v: 1,
            project_id: PROJECT.parse().unwrap(),
            batch_id: BATCH.parse().unwrap(),
            device_id: DEVICE.parse().unwrap(),
            mode: EnvelopeMode::Plain,
            key_epoch: None,
            payload: b"abc".to_vec(),
            signature: vec![1, 2, 3],
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn signing_bytes_are_stable_for_a_plain_envelope() {
        let expected = concat!(
            "6f6c6561666c792d656e76656c6f70652f763100",
            "00000001",
            "01920000000070008000000000000001",
            "01920000000070008000000000000002",
            "01920000000070008000000000000003",
            "00",
            "00",
            "0000000000000003",
            "616263",
        );
        assert_eq!(hex(&envelope().signing_bytes()), expected);
    }

    #[test]
    fn signing_bytes_are_stable_for_an_encrypted_envelope() {
        let encrypted = Envelope {
            mode: EnvelopeMode::E2ee,
            key_epoch: Some(7),
            ..envelope()
        };
        let expected = concat!(
            "6f6c6561666c792d656e76656c6f70652f763100",
            "00000001",
            "01920000000070008000000000000001",
            "01920000000070008000000000000002",
            "01920000000070008000000000000003",
            "01",
            "0100000007",
            "0000000000000003",
            "616263",
        );
        assert_eq!(hex(&encrypted.signing_bytes()), expected);
    }

    #[test]
    fn every_field_except_the_signature_is_covered() {
        let base = envelope();
        let variants = [
            Envelope { v: 2, ..envelope() },
            Envelope {
                project_id: OTHER.parse().unwrap(),
                ..envelope()
            },
            Envelope {
                batch_id: OTHER.parse().unwrap(),
                ..envelope()
            },
            Envelope {
                device_id: OTHER.parse().unwrap(),
                ..envelope()
            },
            Envelope {
                project_id: BATCH.parse().unwrap(),
                batch_id: PROJECT.parse().unwrap(),
                ..envelope()
            },
            Envelope {
                mode: EnvelopeMode::E2ee,
                ..envelope()
            },
            Envelope {
                key_epoch: Some(0),
                ..envelope()
            },
            Envelope {
                key_epoch: Some(1),
                ..envelope()
            },
            Envelope {
                payload: b"abd".to_vec(),
                ..envelope()
            },
            Envelope {
                payload: b"ab".to_vec(),
                ..envelope()
            },
            Envelope {
                payload: Vec::new(),
                ..envelope()
            },
        ];
        let mut seen = std::collections::HashSet::new();
        seen.insert(base.signing_bytes());
        for variant in &variants {
            assert!(seen.insert(variant.signing_bytes()), "{variant:?}");
        }
        let resigned = Envelope {
            signature: vec![9; 64],
            ..envelope()
        };
        assert_eq!(resigned.signing_bytes(), base.signing_bytes());
    }

    #[test]
    fn a_signature_over_the_signing_bytes_verifies_and_breaks_on_tampering() {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let mut signed = envelope();
        signed.signature = pair.sign(&signed.signing_bytes()).as_ref().to_vec();
        assert!(verify_ed25519(
            pair.public_key().as_ref(),
            &signed.signing_bytes(),
            &signed.signature
        ));
        let tampered = Envelope {
            payload: b"abX".to_vec(),
            ..signed.clone()
        };
        assert!(!verify_ed25519(
            pair.public_key().as_ref(),
            &tampered.signing_bytes(),
            &tampered.signature
        ));
    }

    #[test]
    fn envelopes_serialise_binary_fields_as_base64url() {
        let json = format!(
            r#"{{"v":1,"project_id":"{PROJECT}","batch_id":"{BATCH}","device_id":"{DEVICE}","mode":"plain","key_epoch":null,"payload":"YWJj","signature":"AQID"}}"#
        );
        assert_eq!(serde_json::from_str::<Envelope>(&json).unwrap(), envelope());
        assert_eq!(
            serde_json::to_value(envelope()).unwrap(),
            serde_json::from_str::<serde_json::Value>(&json).unwrap()
        );
        assert_eq!(serde_json::to_value(EnvelopeMode::E2ee).unwrap(), "e2ee");
        let padded = json.replace("\"YWJj\"", "\"YWI=\"");
        assert!(serde_json::from_str::<Envelope>(&padded).is_err());
    }

    #[test]
    fn a_mode_from_a_later_version_reads_as_unknown_and_signs_like_no_known_mode() {
        let json = format!(
            r#"{{"v":1,"project_id":"{PROJECT}","batch_id":"{BATCH}","device_id":"{DEVICE}","mode":"sealed","key_epoch":3,"payload":"YWJj","signature":"AQID"}}"#
        );
        let read: Envelope = serde_json::from_str(&json).unwrap();
        assert_eq!(read.mode, EnvelopeMode::Unknown);
        assert_eq!(read.payload, b"abc");
        assert_eq!(
            serde_json::to_value(EnvelopeMode::Unknown).unwrap(),
            "unknown"
        );
        let unknown = Envelope {
            mode: EnvelopeMode::Unknown,
            ..envelope()
        };
        for known in [EnvelopeMode::Plain, EnvelopeMode::E2ee] {
            let signed = Envelope {
                mode: known,
                ..envelope()
            };
            assert_ne!(unknown.signing_bytes(), signed.signing_bytes(), "{known:?}");
        }
    }
}

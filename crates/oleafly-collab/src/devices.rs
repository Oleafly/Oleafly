use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use oleafly_collab_protocol::crypto::{b64url_decode, verify_ed25519};
use oleafly_collab_protocol::envelope::Envelope;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::projects::ProjectDevice;
use serde::{Deserialize, Serialize};

use crate::{write_atomic, CollabError};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Pinned {
    account_id: AccountId,
    public_key: String,
    added_at: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceRegistry {
    devices: BTreeMap<DeviceId, Pinned>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Signed(AccountId),
    Unknown,
    Forged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NewDevice {
    pub account_id: AccountId,
    pub device_id: DeviceId,
}

impl DeviceRegistry {
    pub fn load(path: &Path) -> DeviceRegistry {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), CollabError> {
        let json =
            serde_json::to_vec(self).map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(path, &json)
    }

    pub fn is_empty(&self) -> bool {
        self.devices.is_empty()
    }

    pub fn account_of(&self, device: DeviceId) -> Option<AccountId> {
        self.devices.get(&device).map(|pinned| pinned.account_id)
    }

    pub fn verify(&self, envelope: &Envelope, claimed: Option<AccountId>) -> Verdict {
        let Some(pinned) = self.devices.get(&envelope.device_id) else {
            return Verdict::Unknown;
        };
        if claimed.is_some_and(|account| account != pinned.account_id) {
            return Verdict::Forged;
        }
        let signed = b64url_decode(&pinned.public_key)
            .is_ok_and(|key| verify_ed25519(&key, &envelope.signing_bytes(), &envelope.signature));
        if signed {
            Verdict::Signed(pinned.account_id)
        } else {
            Verdict::Forged
        }
    }

    pub fn pin(&mut self, listed: Vec<ProjectDevice>) -> Vec<NewDevice> {
        let known: BTreeSet<AccountId> = self
            .devices
            .values()
            .map(|pinned| pinned.account_id)
            .collect();
        let mut announced = Vec::new();
        for device in listed {
            if self.devices.contains_key(&device.device_id) {
                continue;
            }
            if known.contains(&device.account_id) {
                announced.push(NewDevice {
                    account_id: device.account_id,
                    device_id: device.device_id,
                });
            }
            self.devices.insert(
                device.device_id,
                Pinned {
                    account_id: device.account_id,
                    public_key: device.public_key,
                    added_at: device.added_at,
                },
            );
        }
        announced
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::test_util::device_key;
    use crate::DeviceKey;
    use oleafly_collab_protocol::envelope::EnvelopeMode;
    use oleafly_collab_protocol::ids::{BatchId, SharedProjectId};

    fn listed(device: DeviceId, account: AccountId, key: &DeviceKey, at: i64) -> ProjectDevice {
        ProjectDevice {
            device_id: device,
            account_id: account,
            public_key: key.public_key_b64(),
            added_at: at,
        }
    }

    fn signed(device: DeviceId, key: &DeviceKey, payload: &[u8]) -> Envelope {
        let mut envelope = Envelope {
            v: 1,
            project_id: SharedProjectId::new_v7(),
            batch_id: BatchId::new_v7(),
            device_id: device,
            mode: EnvelopeMode::Plain,
            key_epoch: None,
            payload: payload.to_vec(),
            signature: Vec::new(),
        };
        envelope.signature = key.sign(&envelope.signing_bytes()).to_vec();
        envelope
    }

    #[test]
    fn a_change_signed_by_a_pinned_device_is_trusted_and_names_its_account() {
        let (alice, laptop, key) = (AccountId::new_v7(), DeviceId::new_v7(), device_key());
        let mut registry = DeviceRegistry::default();
        assert!(registry
            .pin(vec![listed(laptop, alice, &key, 1)])
            .is_empty());
        let change = signed(laptop, &key, b"hello");
        assert_eq!(registry.verify(&change, None), Verdict::Signed(alice));
        assert_eq!(
            registry.verify(&change, Some(alice)),
            Verdict::Signed(alice)
        );
    }

    #[test]
    fn a_tampered_or_misattributed_change_is_forged_and_an_unpinned_one_unknown() {
        let (alice, bob) = (AccountId::new_v7(), AccountId::new_v7());
        let (laptop, key) = (DeviceId::new_v7(), device_key());
        let mut registry = DeviceRegistry::default();
        registry.pin(vec![listed(laptop, alice, &key, 1)]);
        let mut tampered = signed(laptop, &key, b"hello");
        tampered.payload = b"jello".to_vec();
        assert_eq!(registry.verify(&tampered, None), Verdict::Forged);
        let impostor = signed(laptop, &device_key(), b"hello");
        assert_eq!(registry.verify(&impostor, None), Verdict::Forged);
        let honest = signed(laptop, &key, b"hello");
        assert_eq!(registry.verify(&honest, Some(bob)), Verdict::Forged);
        let stranger = signed(DeviceId::new_v7(), &key, b"hello");
        assert_eq!(registry.verify(&stranger, None), Verdict::Unknown);
    }

    #[test]
    fn the_first_listing_pins_quietly_and_a_later_device_of_a_known_account_is_announced() {
        let (alice, carol) = (AccountId::new_v7(), AccountId::new_v7());
        let (laptop, desktop, phone) = (DeviceId::new_v7(), DeviceId::new_v7(), DeviceId::new_v7());
        let (laptop_key, desktop_key) = (device_key(), device_key());
        let mut registry = DeviceRegistry::default();
        assert!(registry
            .pin(vec![
                listed(laptop, alice, &laptop_key, 1),
                listed(desktop, alice, &desktop_key, 2),
            ])
            .is_empty());
        let carol_key = device_key();
        let tablet = DeviceId::new_v7();
        let phone_key = device_key();
        let announced = registry.pin(vec![
            listed(laptop, alice, &laptop_key, 1),
            listed(desktop, alice, &desktop_key, 2),
            listed(phone, alice, &phone_key, 3),
            listed(tablet, carol, &carol_key, 4),
            listed(DeviceId::new_v7(), carol, &device_key(), 5),
        ]);
        assert_eq!(
            announced,
            vec![NewDevice {
                account_id: alice,
                device_id: phone,
            }]
        );
        assert_eq!(
            registry.verify(&signed(tablet, &carol_key, b"x"), None),
            Verdict::Signed(carol)
        );
    }

    #[test]
    fn a_pinned_key_is_never_replaced_by_a_later_listing() {
        let (alice, laptop, key) = (AccountId::new_v7(), DeviceId::new_v7(), device_key());
        let mut registry = DeviceRegistry::default();
        registry.pin(vec![listed(laptop, alice, &key, 1)]);
        let swapped = device_key();
        assert!(registry
            .pin(vec![listed(laptop, alice, &swapped, 1)])
            .is_empty());
        assert_eq!(
            registry.verify(&signed(laptop, &swapped, b"x"), None),
            Verdict::Forged
        );
        assert_eq!(
            registry.verify(&signed(laptop, &key, b"x"), None),
            Verdict::Signed(alice)
        );
    }

    #[test]
    fn pinned_devices_survive_a_save_and_load_and_a_missing_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("devices.json");
        assert!(DeviceRegistry::load(&path).is_empty());
        let (alice, laptop, key) = (AccountId::new_v7(), DeviceId::new_v7(), device_key());
        let mut registry = DeviceRegistry::default();
        registry.pin(vec![listed(laptop, alice, &key, 1)]);
        registry.save(&path).unwrap();
        let loaded = DeviceRegistry::load(&path);
        assert_eq!(loaded, registry);
        assert_eq!(
            loaded.verify(&signed(laptop, &key, b"x"), None),
            Verdict::Signed(alice)
        );
    }
}

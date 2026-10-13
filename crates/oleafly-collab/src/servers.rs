use std::collections::BTreeMap;

use oleafly_collab_protocol::auth::{AccountSummary, SessionEndReason};
use oleafly_collab_protocol::ids::ServerId;
use serde::{Deserialize, Serialize};

use crate::{write_atomic, CollabError, CollabPaths};

const REGISTRY_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerEntry {
    pub server_id: ServerId,
    pub url: String,
    pub name: String,
    pub icon_url: Option<String>,
    pub account: Option<AccountSummary>,
    pub added_at: i64,
}

#[derive(Clone, Debug, Default)]
pub struct ServerRegistry {
    servers: Vec<ServerEntry>,
    ended: BTreeMap<ServerId, SessionEndReason>,
}

#[derive(Deserialize)]
struct RegistryFile {
    version: u32,
    servers: Vec<ServerEntry>,
    #[serde(default)]
    ended: BTreeMap<ServerId, SessionEndReason>,
}

#[derive(Serialize)]
struct RegistryFileRef<'a> {
    version: u32,
    servers: &'a [ServerEntry],
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    ended: &'a BTreeMap<ServerId, SessionEndReason>,
}

impl ServerRegistry {
    pub fn load(paths: &CollabPaths) -> Result<ServerRegistry, CollabError> {
        let path = paths.servers_file();
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ServerRegistry::default());
            }
            Err(error) => {
                return Err(CollabError::Io(format!("{}: {error}", path.display())));
            }
        };
        let file: RegistryFile = serde_json::from_slice(&bytes)
            .map_err(|error| CollabError::Corrupt(format!("{}: {error}", path.display())))?;
        if file.version != REGISTRY_VERSION {
            return Err(CollabError::Corrupt(format!(
                "{}: unsupported version {}",
                path.display(),
                file.version
            )));
        }
        Ok(ServerRegistry {
            servers: file.servers,
            ended: file.ended,
        })
    }

    pub fn save(&self, paths: &CollabPaths) -> Result<(), CollabError> {
        std::fs::create_dir_all(paths.root())
            .map_err(|error| CollabError::Io(format!("{}: {error}", paths.root().display())))?;
        let file = RegistryFileRef {
            version: REGISTRY_VERSION,
            servers: &self.servers,
            ended: &self.ended,
        };
        let bytes = serde_json::to_vec_pretty(&file)
            .map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(&paths.servers_file(), &bytes)
    }

    pub fn list(&self) -> &[ServerEntry] {
        &self.servers
    }

    pub fn get(&self, id: ServerId) -> Option<&ServerEntry> {
        self.servers.iter().find(|entry| entry.server_id == id)
    }

    pub fn upsert(&mut self, entry: ServerEntry) {
        match self
            .servers
            .iter_mut()
            .find(|existing| existing.server_id == entry.server_id)
        {
            Some(existing) => *existing = entry,
            None => self.servers.push(entry),
        }
    }

    pub fn ended(&self, id: ServerId) -> Option<SessionEndReason> {
        self.ended.get(&id).copied()
    }

    pub fn set_ended(&mut self, id: ServerId, reason: Option<SessionEndReason>) {
        match reason {
            Some(reason) if self.get(id).is_some() => {
                self.ended.insert(id, reason);
            }
            _ => {
                self.ended.remove(&id);
            }
        }
    }

    pub fn remove(&mut self, id: ServerId) -> Option<ServerEntry> {
        self.ended.remove(&id);
        let index = self
            .servers
            .iter()
            .position(|entry| entry.server_id == id)?;
        Some(self.servers.remove(index))
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::auth::SessionEndReason;
    use oleafly_collab_protocol::ids::AccountId;
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;

    fn paths(dir: &tempfile::TempDir) -> CollabPaths {
        CollabPaths::new(dir.path().join("collab"))
    }

    fn entry(name: &str) -> ServerEntry {
        ServerEntry {
            server_id: ServerId::new_v7(),
            url: format!("https://{name}.example/oleafly"),
            name: name.to_string(),
            icon_url: None,
            account: None,
            added_at: 1_760_000_000_000,
        }
    }

    fn carol() -> AccountSummary {
        AccountSummary {
            account_id: AccountId::new_v7(),
            display_name: "Carol Smith".to_string(),
            avatar_url: Some("https://avatars.example/carol.png".to_string()),
            server_role: ServerRole::Admin,
            emails: vec!["carol@uni.edu".to_string()],
            logins: vec!["carol".to_string()],
        }
    }

    #[test]
    fn missing_file_is_an_empty_registry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let registry = ServerRegistry::load(&paths(&dir)).expect("load");
        assert!(registry.list().is_empty());
    }

    #[test]
    fn saved_entries_load_back_in_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(&dir);
        let mut first = entry("smith-lab");
        first.account = Some(carol());
        let second = entry("jones-lab");
        let mut registry = ServerRegistry::default();
        registry.upsert(first.clone());
        registry.upsert(second.clone());
        registry.save(&paths).expect("save");
        let loaded = ServerRegistry::load(&paths).expect("load");
        let ids: Vec<ServerId> = loaded.list().iter().map(|item| item.server_id).collect();
        assert_eq!(ids, vec![first.server_id, second.server_id]);
        let account = loaded
            .get(first.server_id)
            .and_then(|item| item.account.as_ref())
            .expect("account");
        assert_eq!(account.display_name, "Carol Smith");
        assert!(matches!(account.server_role, ServerRole::Admin));
        assert_eq!(
            loaded.get(second.server_id).map(|item| item.url.as_str()),
            Some("https://jones-lab.example/oleafly")
        );
    }

    #[test]
    fn upsert_replaces_in_place_and_remove_returns_the_entry() {
        let mut registry = ServerRegistry::default();
        let first = entry("smith-lab");
        registry.upsert(first.clone());
        registry.upsert(entry("jones-lab"));
        let mut renamed = first.clone();
        renamed.name = "Smith Lab".to_string();
        registry.upsert(renamed);
        assert_eq!(registry.list().len(), 2);
        assert_eq!(registry.list()[0].name, "Smith Lab");
        let removed = registry.remove(first.server_id).expect("removed");
        assert_eq!(removed.server_id, first.server_id);
        assert!(registry.get(first.server_id).is_none());
        assert!(registry.remove(first.server_id).is_none());
    }

    #[test]
    fn file_is_versioned_json_at_the_servers_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(&dir);
        let saved = entry("smith-lab");
        let mut registry = ServerRegistry::default();
        registry.upsert(saved.clone());
        registry.save(&paths).expect("save");
        let text = std::fs::read_to_string(paths.servers_file()).expect("read");
        let value: serde_json::Value = serde_json::from_str(&text).expect("json");
        assert_eq!(value["version"], 1);
        assert_eq!(
            value["servers"][0]["server_id"],
            saved.server_id.to_string()
        );
        assert_eq!(value["servers"][0]["name"], "smith-lab");
    }

    #[test]
    fn a_server_remembers_why_its_session_ended_until_told_otherwise() {
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(&dir);
        let paused = entry("smith-lab");
        let other = entry("jones-lab");
        let mut registry = ServerRegistry::default();
        registry.upsert(paused.clone());
        registry.upsert(other.clone());
        registry.set_ended(paused.server_id, Some(SessionEndReason::AccountSuspended));
        registry.save(&paths).expect("save");
        let mut loaded = ServerRegistry::load(&paths).expect("load");
        assert_eq!(
            loaded.ended(paused.server_id),
            Some(SessionEndReason::AccountSuspended)
        );
        assert_eq!(loaded.ended(other.server_id), None);
        loaded.upsert(paused.clone());
        assert_eq!(
            loaded.ended(paused.server_id),
            Some(SessionEndReason::AccountSuspended)
        );
        loaded.set_ended(paused.server_id, None);
        assert_eq!(loaded.ended(paused.server_id), None);
        loaded.set_ended(paused.server_id, Some(SessionEndReason::AccessEnded));
        loaded.remove(paused.server_id);
        loaded.upsert(paused.clone());
        assert_eq!(loaded.ended(paused.server_id), None);
        loaded.set_ended(ServerId::new_v7(), Some(SessionEndReason::AccessEnded));
        assert_eq!(loaded.list().len(), 2);
    }

    #[test]
    fn an_earlier_app_still_reads_a_list_that_names_ended_sessions() {
        #[derive(serde::Deserialize)]
        struct EarlierFile {
            version: u32,
            servers: Vec<ServerEntry>,
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(&dir);
        let paused = entry("smith-lab");
        let mut registry = ServerRegistry::default();
        registry.upsert(paused.clone());
        registry.set_ended(paused.server_id, Some(SessionEndReason::AccessEnded));
        registry.save(&paths).expect("save");
        let text = std::fs::read_to_string(paths.servers_file()).expect("read");
        let earlier: EarlierFile = serde_json::from_str(&text).expect("an earlier app reads it");
        assert_eq!(earlier.version, 1);
        assert_eq!(earlier.servers.len(), 1);
    }

    #[test]
    fn unreadable_file_is_corrupt() {
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(&dir);
        std::fs::create_dir_all(paths.root()).expect("root");
        std::fs::write(paths.servers_file(), b"{not json").expect("write");
        assert!(matches!(
            ServerRegistry::load(&paths),
            Err(CollabError::Corrupt(_))
        ));
    }
}

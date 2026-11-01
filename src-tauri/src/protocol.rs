use serde::Serialize;

pub const PROTOCOL_VERSION: u32 = 7;
pub const CAPABILITIES: [&str; 12] = [
    "agent-server",
    "agent-stream",
    "chats",
    "checkpoints",
    "collab",
    "compile",
    "git",
    "initial-state",
    "mcp",
    "search",
    "synctex",
    "templates",
];

#[derive(Serialize)]
pub struct BackendProtocolInfo {
    pub protocol_version: u32,
    pub capabilities: Vec<&'static str>,
}

#[tauri::command]
pub fn backend_protocol_info() -> BackendProtocolInfo {
    BackendProtocolInfo {
        protocol_version: PROTOCOL_VERSION,
        capabilities: CAPABILITIES.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_sorted_and_unique() {
        let mut sorted = CAPABILITIES.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted, CAPABILITIES.to_vec());
    }

    #[test]
    fn info_reports_the_declared_contract() {
        let info = backend_protocol_info();
        assert_eq!(info.protocol_version, PROTOCOL_VERSION);
        assert_eq!(info.capabilities, CAPABILITIES.to_vec());
    }

    #[test]
    fn reports_the_collaboration_capability() {
        assert!(backend_protocol_info().capabilities.contains(&"collab"));
    }
}

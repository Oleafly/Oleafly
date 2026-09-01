// Backend parity for the Computer-Use Agent risk policy (see
// packages/ai-tools/src/cua.ts). The driver itself runs in the webview
// sandbox surface; this is the authoritative classifier the confirmation
// gate consults, kept in Rust so the policy cannot be weakened from the
// renderer. Read-only observation is auto; anything that navigates or mutates
// the page is confirmed.

pub fn cua_action_requires_confirm(action: &str) -> bool {
    !matches!(action, "read" | "screenshot" | "scroll" | "wait")
}

#[tauri::command]
pub fn cua_action_confirm(action: String) -> bool {
    cua_action_requires_confirm(&action)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_actions_are_auto() {
        for action in ["read", "screenshot", "scroll", "wait"] {
            assert!(
                !cua_action_requires_confirm(action),
                "{action} should be auto"
            );
        }
    }

    #[test]
    fn mutating_actions_require_confirmation() {
        for action in ["navigate", "click", "type", "submit", "anything-else"] {
            assert!(
                cua_action_requires_confirm(action),
                "{action} should confirm"
            );
        }
    }
}

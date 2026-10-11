use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerRole {
    Admin,
    Maintainer,
    Member,
    Guest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectRole {
    Owner,
    Editor,
    Viewer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ServerAction {
    ManageMembers,
    ManageDomainRules,
    ApproveGuests,
    ReadSecurityLog,
    SignOutAnyDevice,
    ManageStaff,
    ChangeSettings,
    ViewStorage,
    DeleteProjectForStorage,
    ShareProjects,
    SeeDirectory,
}

pub fn server_role_allows(role: ServerRole, action: ServerAction) -> bool {
    let (maintainer, member) = match action {
        ServerAction::ManageMembers
        | ServerAction::ManageDomainRules
        | ServerAction::ApproveGuests
        | ServerAction::ReadSecurityLog
        | ServerAction::SignOutAnyDevice => (true, false),
        ServerAction::ManageStaff
        | ServerAction::ChangeSettings
        | ServerAction::ViewStorage
        | ServerAction::DeleteProjectForStorage => (false, false),
        ServerAction::ShareProjects | ServerAction::SeeDirectory => (true, true),
    };
    match role {
        ServerRole::Admin => true,
        ServerRole::Maintainer => maintainer,
        ServerRole::Member => member,
        ServerRole::Guest => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ordinal(action: ServerAction) -> usize {
        match action {
            ServerAction::ManageMembers => 0,
            ServerAction::ManageDomainRules => 1,
            ServerAction::ApproveGuests => 2,
            ServerAction::ReadSecurityLog => 3,
            ServerAction::SignOutAnyDevice => 4,
            ServerAction::ManageStaff => 5,
            ServerAction::ChangeSettings => 6,
            ServerAction::ViewStorage => 7,
            ServerAction::DeleteProjectForStorage => 8,
            ServerAction::ShareProjects => 9,
            ServerAction::SeeDirectory => 10,
        }
    }

    const TRUTH_TABLE: [(ServerAction, bool, bool); 11] = [
        (ServerAction::ManageMembers, true, false),
        (ServerAction::ManageDomainRules, true, false),
        (ServerAction::ApproveGuests, true, false),
        (ServerAction::ReadSecurityLog, true, false),
        (ServerAction::SignOutAnyDevice, true, false),
        (ServerAction::ManageStaff, false, false),
        (ServerAction::ChangeSettings, false, false),
        (ServerAction::ViewStorage, false, false),
        (ServerAction::DeleteProjectForStorage, false, false),
        (ServerAction::ShareProjects, true, true),
        (ServerAction::SeeDirectory, true, true),
    ];

    #[test]
    fn the_truth_table_lists_every_action_exactly_once() {
        for (index, (action, _, _)) in TRUTH_TABLE.iter().enumerate() {
            assert_eq!(ordinal(*action), index, "{action:?}");
        }
    }

    #[test]
    fn server_roles_follow_the_rbac_truth_table() {
        for (action, maintainer, member) in TRUTH_TABLE {
            assert!(
                server_role_allows(ServerRole::Admin, action),
                "admin {action:?}"
            );
            assert_eq!(
                server_role_allows(ServerRole::Maintainer, action),
                maintainer,
                "maintainer {action:?}"
            );
            assert_eq!(
                server_role_allows(ServerRole::Member, action),
                member,
                "member {action:?}"
            );
            assert!(
                !server_role_allows(ServerRole::Guest, action),
                "guest {action:?}"
            );
        }
    }

    #[test]
    fn roles_serialise_in_snake_case() {
        let server: Vec<String> = [
            ServerRole::Admin,
            ServerRole::Maintainer,
            ServerRole::Member,
            ServerRole::Guest,
        ]
        .iter()
        .map(|role| serde_json::to_string(role).unwrap())
        .collect();
        assert_eq!(
            server,
            ["\"admin\"", "\"maintainer\"", "\"member\"", "\"guest\""]
        );
        let project: Vec<String> = [ProjectRole::Owner, ProjectRole::Editor, ProjectRole::Viewer]
            .iter()
            .map(|role| serde_json::to_string(role).unwrap())
            .collect();
        assert_eq!(project, ["\"owner\"", "\"editor\"", "\"viewer\""]);
        assert_eq!(
            serde_json::from_str::<ProjectRole>("\"viewer\"").unwrap(),
            ProjectRole::Viewer
        );
        assert!(serde_json::from_str::<ServerRole>("\"Admin\"").is_err());
    }
}

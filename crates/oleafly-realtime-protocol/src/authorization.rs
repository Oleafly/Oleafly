use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectRole {
    Viewer,
    Commenter,
    Editor,
    Owner,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectCapability {
    SourceRead,
    PresenceJoin,
    CompilePrivate,
    ReviewRead,
    ReviewCreate,
    ReviewManageOwn,
    SourceWrite,
    TreeWrite,
    BinaryWrite,
    ReviewModerate,
    SuggestionDecide,
    VersionCreate,
    VersionRestoreFile,
    ArtifactPublish,
    ArtifactSelectCurrent,
    MembershipManage,
    ProjectControlsManage,
    ReviewHideAbuse,
    VersionRestoreProject,
    PublisherPolicyManage,
    LifecycleManage,
    OwnershipTransfer,
}

const VIEWER: &[ProjectCapability] = &[
    ProjectCapability::SourceRead,
    ProjectCapability::PresenceJoin,
    ProjectCapability::CompilePrivate,
    ProjectCapability::ReviewRead,
];
const COMMENTER: &[ProjectCapability] = &[
    ProjectCapability::SourceRead,
    ProjectCapability::PresenceJoin,
    ProjectCapability::CompilePrivate,
    ProjectCapability::ReviewRead,
    ProjectCapability::ReviewCreate,
    ProjectCapability::ReviewManageOwn,
];
const EDITOR: &[ProjectCapability] = &[
    ProjectCapability::SourceRead,
    ProjectCapability::PresenceJoin,
    ProjectCapability::CompilePrivate,
    ProjectCapability::ReviewRead,
    ProjectCapability::ReviewCreate,
    ProjectCapability::ReviewManageOwn,
    ProjectCapability::SourceWrite,
    ProjectCapability::TreeWrite,
    ProjectCapability::BinaryWrite,
    ProjectCapability::ReviewModerate,
    ProjectCapability::SuggestionDecide,
    ProjectCapability::VersionCreate,
    ProjectCapability::VersionRestoreFile,
    ProjectCapability::ArtifactPublish,
    ProjectCapability::ArtifactSelectCurrent,
];
const OWNER: &[ProjectCapability] = &[
    ProjectCapability::SourceRead,
    ProjectCapability::PresenceJoin,
    ProjectCapability::CompilePrivate,
    ProjectCapability::ReviewRead,
    ProjectCapability::ReviewCreate,
    ProjectCapability::ReviewManageOwn,
    ProjectCapability::SourceWrite,
    ProjectCapability::TreeWrite,
    ProjectCapability::BinaryWrite,
    ProjectCapability::ReviewModerate,
    ProjectCapability::SuggestionDecide,
    ProjectCapability::VersionCreate,
    ProjectCapability::VersionRestoreFile,
    ProjectCapability::ArtifactPublish,
    ProjectCapability::ArtifactSelectCurrent,
    ProjectCapability::MembershipManage,
    ProjectCapability::ProjectControlsManage,
    ProjectCapability::ReviewHideAbuse,
    ProjectCapability::VersionRestoreProject,
    ProjectCapability::PublisherPolicyManage,
    ProjectCapability::LifecycleManage,
    ProjectCapability::OwnershipTransfer,
];

impl ProjectRole {
    pub const fn capabilities(self) -> &'static [ProjectCapability] {
        match self {
            Self::Viewer => VIEWER,
            Self::Commenter => COMMENTER,
            Self::Editor => EDITOR,
            Self::Owner => OWNER,
        }
    }

    pub fn has(self, capability: ProjectCapability) -> bool {
        self.capabilities().contains(&capability)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_editors_and_owners_write_source() {
        assert!(!ProjectRole::Viewer.has(ProjectCapability::SourceWrite));
        assert!(!ProjectRole::Commenter.has(ProjectCapability::SourceWrite));
        assert!(ProjectRole::Editor.has(ProjectCapability::SourceWrite));
        assert!(ProjectRole::Owner.has(ProjectCapability::SourceWrite));
    }
}

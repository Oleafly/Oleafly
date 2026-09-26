use std::path::Path;

pub(crate) fn reset_project_grants(data_root: &Path, project_id: &str) -> Result<(), String> {
    crate::paths::validate_project_id(project_id)?;
    crate::trust::revoke_project(project_id).map_err(String::from)?;
    crate::approvals::revoke_project_grants(data_root, project_id)?;
    crate::project::revoke_shell_escape_trust(project_id)?;
    crate::research_workspace::roots::forget_project_strict(project_id)
}

#[cfg(test)]
mod tests {
    use crate::approvals::{ApprovalMode, ToolDecision};
    use crate::research_workspace::{AddResearchRootRequest, ResearchRootAccess, ResearchRootRole};
    use crate::trust::testing::LinkedFixture;
    use crate::trust::TrustScope;

    #[test]
    fn a_reset_revokes_every_grant_for_one_project_and_is_idempotent() {
        let fixture = LinkedFixture::new();
        let outside = tempfile::tempdir().unwrap();
        let root = crate::paths::oleafly_root().unwrap();
        let (project_id, _) = fixture.link("rebound");
        let (bystander, _) = fixture.link("bystander");
        for id in [&project_id, &bystander] {
            fixture.trust(id, TrustScope::Folder);
            crate::approvals::set_mode(&root, id, ApprovalMode::FullAccess).unwrap();
            crate::project::write_shell_escape_trust(id).unwrap();
        }
        crate::approvals::set_decision(&root, &project_id, "run_command", Some(ToolDecision::Deny))
            .unwrap();
        crate::research_workspace::roots::add_root(AddResearchRootRequest {
            project_id: project_id.clone(),
            path: outside.path().to_string_lossy().into_owned(),
            label: "Data".into(),
            role: ResearchRootRole::Data,
            access: ResearchRootAccess::ReadWrite,
        })
        .unwrap();
        assert!(crate::trust::is_trusted(&project_id));

        super::reset_project_grants(&root, &project_id).unwrap();
        super::reset_project_grants(&root, &project_id).unwrap();

        assert_eq!(
            crate::approvals::policy_for(&root, &project_id, "run_command").unwrap(),
            (ApprovalMode::Custom, Some(ToolDecision::Deny))
        );
        assert!(!crate::project::shell_escape_trusted(&project_id).unwrap());
        assert!(!crate::trust::is_trusted(&project_id));
        assert!(crate::research_workspace::roots::get_workspace(&project_id)
            .unwrap()
            .roots
            .is_empty());
        assert_eq!(
            crate::approvals::policy_for(&root, &bystander, "write_file")
                .unwrap()
                .0,
            ApprovalMode::FullAccess
        );
        assert!(crate::project::shell_escape_trusted(&bystander).unwrap());
        assert!(crate::trust::is_trusted(&bystander));
        assert!(super::reset_project_grants(&root, "../escape").is_err());
    }

    #[test]
    fn a_reset_never_removes_trust_granted_to_a_parent_folder() {
        let fixture = LinkedFixture::new();
        let root = crate::paths::oleafly_root().unwrap();
        let (project_id, _) = fixture.link("parent/child");
        fixture.trust(&project_id, TrustScope::Parent);
        let (sibling, _) = fixture.link("parent/sibling");
        assert!(crate::trust::is_trusted(&sibling));

        super::reset_project_grants(&root, &project_id).unwrap();

        assert!(crate::trust::is_trusted(&sibling));
    }
}

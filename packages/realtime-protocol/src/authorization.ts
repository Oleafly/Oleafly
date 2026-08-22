export const PROJECT_ROLES = ["viewer", "commenter", "editor", "owner"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_CAPABILITIES = [
  "source_read",
  "presence_join",
  "compile_private",
  "review_read",
  "review_create",
  "review_manage_own",
  "source_write",
  "tree_write",
  "binary_write",
  "review_moderate",
  "suggestion_decide",
  "version_create",
  "version_restore_file",
  "artifact_publish",
  "artifact_select_current",
  "membership_manage",
  "project_controls_manage",
  "review_hide_abuse",
  "version_restore_project",
  "publisher_policy_manage",
  "lifecycle_manage",
  "ownership_transfer",
] as const;

export type ProjectCapability = (typeof PROJECT_CAPABILITIES)[number];

const VIEWER_CAPABILITIES = [
  "source_read",
  "presence_join",
  "compile_private",
  "review_read",
] as const satisfies readonly ProjectCapability[];

const COMMENTER_CAPABILITIES = [
  ...VIEWER_CAPABILITIES,
  "review_create",
  "review_manage_own",
] as const satisfies readonly ProjectCapability[];

const EDITOR_CAPABILITIES = [
  ...COMMENTER_CAPABILITIES,
  "source_write",
  "tree_write",
  "binary_write",
  "review_moderate",
  "suggestion_decide",
  "version_create",
  "version_restore_file",
  "artifact_publish",
  "artifact_select_current",
] as const satisfies readonly ProjectCapability[];

export const ROLE_CAPABILITIES = {
  viewer: VIEWER_CAPABILITIES,
  commenter: COMMENTER_CAPABILITIES,
  editor: EDITOR_CAPABILITIES,
  owner: [
    ...EDITOR_CAPABILITIES,
    "membership_manage",
    "project_controls_manage",
    "review_hide_abuse",
    "version_restore_project",
    "publisher_policy_manage",
    "lifecycle_manage",
    "ownership_transfer",
  ],
} as const satisfies Record<ProjectRole, readonly ProjectCapability[]>;

export function roleHasCapability(
  role: ProjectRole,
  capability: ProjectCapability,
): boolean {
  return (ROLE_CAPABILITIES[role] as readonly ProjectCapability[]).includes(
    capability,
  );
}

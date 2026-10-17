import type {
  CollabAccount,
  CollabAllowlistEntry,
  CollabCapabilities,
  CollabConnectionCheck,
  CollabDevice,
  CollabDomainRule,
  CollabMember,
  CollabPerson,
  CollabProjectMember,
  CollabProjectSummary,
  CollabRuntimeSettings,
  CollabSecurityEvent,
  CollabSecurityLogKind,
  CollabServer,
  CollabShareCheck,
  CollabShareInfo,
  CollabSharedWithMe,
  ProjectInfo,
} from "@/lib/tauri";

export const SERVER_ID = "0192a0b0-0000-7000-8000-0000000000a1";
export const ALICE_ID = "0192a0b0-0000-7000-8000-000000000001";
export const BOB_ID = "0192a0b0-0000-7000-8000-000000000002";
export const CAROL_ID = "0192a0b0-0000-7000-8000-000000000003";

export function account(overrides: Partial<CollabAccount> = {}): CollabAccount {
  return {
    account_id: ALICE_ID,
    display_name: "Alice Chen",
    avatar_url: null,
    server_role: "member",
    emails: ["alice@uni.edu"],
    logins: ["alice-chen"],
    ...overrides,
  };
}

export function server(overrides: Partial<CollabServer> = {}): CollabServer {
  return {
    server_id: SERVER_ID,
    url: "https://collab.uni.edu",
    name: "Smith Lab",
    icon_url: null,
    account: account(),
    added_at: 1_760_000_000_000,
    signed_in: true,
    ...overrides,
  };
}

export function signedOutServer(overrides: Partial<CollabServer> = {}): CollabServer {
  return server({ account: null, signed_in: false, ...overrides });
}

export function capabilities(overrides: Partial<CollabCapabilities> = {}): CollabCapabilities {
  return {
    server_id: SERVER_ID,
    name: "Smith Lab",
    icon_url: null,
    version: "1.0.0",
    protocol: { min: 1, max: 1 },
    needs_setup: false,
    providers: [{ id: "github", kind: "github", label: "GitHub" }],
    features: {
      email: false,
      guests: false,
      link_sharing: false,
      access_logs: false,
      comments: false,
      encryption: "none",
    },
    limits: { max_project_mb: 200, max_file_mb: 50, max_members_per_project: 20 },
    ...overrides,
  };
}

export function device(overrides: Partial<CollabDevice> = {}): CollabDevice {
  return {
    device_id: "0192a0b0-0000-7000-8000-0000000000d1",
    name: "Alice's MacBook",
    platform: "macos",
    created_at: 1_760_000_000_000,
    last_seen_at: 1_760_100_000_000,
    current: false,
    ...overrides,
  };
}

export function member(
  overrides: Partial<CollabAccount> = {},
  status: CollabMember["status"] = "active",
): CollabMember {
  return { account: account(overrides), status, created_at: 1_760_000_000_000 };
}

export function allowlistEntry(overrides: Partial<CollabAllowlistEntry> = {}): CollabAllowlistEntry {
  return {
    id: "allow-1",
    matcher: { kind: "email", email: "dan@uni.edu" },
    role: "member",
    created_at: 1_760_000_000_000,
    bound_account: null,
    ...overrides,
  };
}

export function domainRule(overrides: Partial<CollabDomainRule> = {}): CollabDomainRule {
  return { id: "domain-1", domain: "cs.uni.edu", role: "member", created_at: 1_760_000_000_000, ...overrides };
}

export function runtimeSettings(overrides: Partial<CollabRuntimeSettings> = {}): CollabRuntimeSettings {
  return {
    guests_enabled: false,
    guest_approval_required: true,
    directory_visible: true,
    directory_shows_email: true,
    link_sharing_allowed: true,
    access_logs_allowed: true,
    email_notifications: true,
    comments_allowed: true,
    ...overrides,
  };
}

export function securityEvent(
  overrides: Partial<Omit<CollabSecurityEvent, "kind">> & { kind?: CollabSecurityLogKind } = {},
): CollabSecurityEvent {
  return {
    id: 1,
    at: 1_760_000_000_000,
    actor: ALICE_ID,
    kind: "sign_in",
    target: null,
    ip: "203.0.113.7",
    detail: {},
    ...overrides,
  } as CollabSecurityEvent;
}

export function check(
  id: CollabConnectionCheck["id"],
  status: CollabConnectionCheck["status"],
  detail: string | null = null,
): CollabConnectionCheck {
  return { id, status, detail };
}

export function collabError(code: string, message = "raw server text"): { code: string; message: string } {
  return { code, message };
}

export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? "");
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export const SHARED_ID = "0192a0b0-0000-7000-8000-0000000000b1";

export function person(overrides: Partial<CollabPerson> = {}): CollabPerson {
  return {
    account_id: ALICE_ID,
    display_name: "Alice Chen",
    avatar_url: null,
    email: "alice@uni.edu",
    login: "alice-chen",
    ...overrides,
  };
}

export const BOB = person({ account_id: BOB_ID, display_name: "Bob Smith", email: "bob@uni.edu", login: "bobsmith" });
export const CAROL = person({ account_id: CAROL_ID, display_name: "Carol Diaz", email: null, login: "carol" });

export function projectMember(
  who: CollabPerson = person(),
  role: CollabProjectMember["role"] = "editor",
): CollabProjectMember {
  return { person: who, role, granted_at: 1_760_000_000_000 };
}

export function shareInfo(overrides: Partial<CollabShareInfo> = {}): CollabShareInfo {
  return {
    project_id: "grant",
    server_id: SERVER_ID,
    server_name: "Smith Lab",
    server_url: "https://collab.uni.edu",
    shared_project_id: SHARED_ID,
    role: "owner",
    link: `https://collab.uni.edu/p/${SHARED_ID}`,
    account_id: BOB_ID,
    ...overrides,
  };
}

export function shareCheck(overrides: Partial<CollabShareCheck> = {}): CollabShareCheck {
  return {
    server_name: "Smith Lab",
    file_count: 12,
    total_bytes: 3 * 1024 * 1024,
    excluded: [".oleafly/", "main.pdf"],
    too_large: [],
    renamed: [],
    max_file_mb: 50,
    cloud_synced: false,
    ...overrides,
  };
}

export function projectSummary(overrides: Partial<CollabProjectSummary> = {}): CollabProjectSummary {
  return {
    project_id: SHARED_ID,
    title: "Grant proposal",
    owner: BOB,
    role: "owner",
    status: "active",
    created_at: 1_760_000_000_000,
    link_sharing: false,
    link_role: "viewer",
    head_seq: 4,
    ...overrides,
  };
}

export function sharedWithMe(overrides: Partial<CollabSharedWithMe> = {}): CollabSharedWithMe {
  return {
    server_id: SERVER_ID,
    server_name: "Smith Lab",
    project: projectSummary({ role: "editor" }),
    local_project_id: null,
    ...overrides,
  };
}

export function libraryProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "grant",
    name: "Grant proposal",
    main_doc: "main.tex",
    kind: "document",
    created_at: 1_760_000_000,
    updated_at: 1_760_000_000,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

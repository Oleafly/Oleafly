// Recognized remote forms:
//   git@github.com:owner/repo.git      -> https://github.com/owner/repo
//   ssh://git@github.com/owner/repo.git -> https://github.com/owner/repo
//   https://user@github.com/owner/repo.git -> https://github.com/owner/repo
export function toGithubWebUrl(remote: string | null | undefined): string | null {
  let u = (remote ?? "").trim();
  if (!u) return null;
  // Explicit ssh:// scheme: ssh://[user@]host[:port]/owner/repo. Handle this
  // before the scp-style shorthand so an explicit port is dropped rather than
  // mistaken for a path segment.
  const ssh = u.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/);
  if (ssh) {
    u = `https://${ssh[1]}/${ssh[2]}`;
  } else {
    // scp-like shorthand: git@host:owner/repo (no scheme, no port).
    const scp = u.match(/^[^@]+@([^:]+):(.+)$/);
    if (scp) u = `https://${scp[1]}/${scp[2]}`;
  }
  u = u.replace(/^git:\/\//, "https://");
  // strip embedded credentials in an https URL
  u = u.replace(/^https:\/\/[^@/]+@/, "https://");
  u = u.replace(/\.git$/, "").replace(/\/+$/, "");
  return /^https?:\/\/.+\/.+/.test(u) ? u : null;
}

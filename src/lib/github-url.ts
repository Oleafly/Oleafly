/**
 * Convert a git remote URL into a browsable https web URL, or null if it isn't
 * a recognizable http(s)/ssh git remote. Handles the common forms:
 *   git@github.com:owner/repo.git      -> https://github.com/owner/repo
 *   ssh://git@github.com/owner/repo.git -> https://github.com/owner/repo
 *   https://user@github.com/owner/repo.git -> https://github.com/owner/repo
 */
export function toGithubWebUrl(remote: string | null | undefined): string | null {
  let u = (remote ?? "").trim();
  if (!u) return null;
  // scp-like: git@host:owner/repo
  const scp = u.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp) u = `https://${scp[1]}/${scp[2]}`;
  u = u.replace(/^ssh:\/\/[^@/]+@/, "https://").replace(/^git:\/\//, "https://");
  // strip embedded credentials in an https URL
  u = u.replace(/^https:\/\/[^@/]+@/, "https://");
  u = u.replace(/\.git$/, "").replace(/\/+$/, "");
  return /^https?:\/\/.+\/.+/.test(u) ? u : null;
}

const DEV_HOOK_TOKEN =
  /data-e2e-[a-z0-9-]+|__(?:agent[A-Za-z0-9_]*|chat[A-Za-z0-9_]*|e2e[A-Za-z0-9_]*|mcp[A-Za-z0-9_]*|gitCommitCount|importFile|importCitationFile|hasPandoc|setNextTikzImport|aiConnect)/g;

export function findProductionDevHookTokens(source) {
  return [...new Set(source.match(DEV_HOOK_TOKEN) ?? [])].sort();
}

export function assertNoProductionDevHookTokens(artifacts) {
  const findings = [];
  for (const [fileName, source] of artifacts) {
    const tokens = findProductionDevHookTokens(source);
    if (tokens.length > 0) findings.push(`${fileName}: ${tokens.join(", ")}`);
  }
  if (findings.length > 0) {
    throw new Error(
      `Production build contains DEV/test hook tokens:\n${findings.join("\n")}`,
    );
  }
}

/**
 * Tauri adds a nonce to style-src when a production HTML asset contains an
 * inline <style> element. CSP then ignores 'unsafe-inline', which prevents
 * style-mod/CodeMirror from mounting its un-nonced runtime stylesheet.
 */
export function findInlineStyleElementCount(source) {
  const markup = source.replace(/<!--[\s\S]*?-->/g, "");
  return markup.match(/<style(?:\s[^>]*)?>/gi)?.length ?? 0;
}

export function assertNoTauriStyleNonceTriggers(artifacts) {
  const findings = [];
  for (const [fileName, source] of artifacts) {
    if (!fileName.endsWith(".html")) continue;
    const count = findInlineStyleElementCount(source);
    if (count > 0) findings.push(`${fileName}: ${count} inline <style> element(s)`);
  }
  if (findings.length > 0) {
    throw new Error(
      `Production HTML would make Tauri nonce style-src and block CodeMirror runtime styles:\n${findings.join("\n")}`,
    );
  }
}

/**
 * The inline-<style> audit above stops the packaged app from *acquiring* a
 * style-src nonce. This is the other half: the configured policy has to permit
 * un-nonced runtime styles in the first place. Dropping 'unsafe-inline' from
 * style-src, or hard-coding a nonce into the config, breaks CodeMirror in the
 * packaged app exactly the way the nonce did - and only in a packaged build,
 * where no dev-mode test would notice.
 */
export function findStyleSrcDirective(csp) {
  if (typeof csp !== "string" || csp.trim() === "") return null;
  for (const directive of csp.split(";")) {
    const parts = directive.trim().split(/\s+/);
    if (parts[0]?.toLowerCase() === "style-src") return parts.slice(1);
  }
  return null;
}

export function assertStyleSrcAllowsRuntimeStyles(csp) {
  const sources = findStyleSrcDirective(csp);
  if (sources === null) {
    throw new Error(
      "Tauri CSP has no style-src directive; CodeMirror's runtime stylesheet " +
        "would fall back to default-src and can be blocked in a packaged build",
    );
  }
  const nonce = sources.find((source) => source.toLowerCase().startsWith("'nonce-"));
  if (nonce) {
    throw new Error(
      `Tauri CSP style-src pins ${nonce}; a nonce makes CSP ignore 'unsafe-inline' ` +
        "and blocks CodeMirror's un-nonced runtime stylesheet",
    );
  }
  if (!sources.some((source) => source.toLowerCase() === "'unsafe-inline'")) {
    throw new Error(
      `Tauri CSP style-src is [${sources.join(" ")}] and does not allow 'unsafe-inline'; ` +
        "CodeMirror mounts its stylesheet at runtime and would be blocked in a packaged build",
    );
  }
}

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

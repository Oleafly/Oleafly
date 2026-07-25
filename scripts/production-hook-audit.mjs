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

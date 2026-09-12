import { maskComments, taggingGate } from "@oleafly/preflight";
import { resolveProjectPath } from "@/lib/project-intelligence/source";

export const canPrepareAccessible = (loaded: boolean, profile: string) =>
  loaded && profile === "latex";

export interface GateDocument {
  source: string;
  origin: "main" | "active";
}

type StoredFiles = Readonly<Record<string, { content?: string } | undefined>>;

const BODY_START = /\\begin\s*\{document\}/;
const PREAMBLE_INPUT = /\\(?:input|include)\s*\{([^}]*)\}/g;
const PREAMBLE_FILE_LIMIT = 24;

const preambleOf = (text: string) => {
  const masked = maskComments(text);
  const body = BODY_START.exec(masked);
  return body ? masked.slice(0, body.index) : masked;
};

export function gateDocument(
  mainPath: string,
  files: StoredFiles,
  activeContent: string,
): GateDocument {
  const main = mainPath ? files[mainPath]?.content : undefined;
  if (!main?.trim()) return { source: activeContent, origin: "active" };

  const visited = new Set<string>([mainPath]);
  const pending: { path: string; text: string }[] = [{ path: mainPath, text: main }];
  const parts: string[] = [];
  while (pending.length > 0 && parts.length < PREAMBLE_FILE_LIMIT) {
    const current = pending.shift();
    if (!current) break;
    const preamble = preambleOf(current.text);
    parts.push(preamble);
    for (const match of preamble.matchAll(PREAMBLE_INPUT)) {
      const target = resolveProjectPath(current.path, match[1], ".tex");
      if (!target || visited.has(target)) continue;
      visited.add(target);
      const text = files[target]?.content;
      if (text !== undefined) pending.push({ path: target, text });
    }
  }
  return { source: parts.join("\n"), origin: "main" };
}

export interface PrepGate {
  offer: boolean;
  classNotice: string | null;
  classSeverity: "block" | "caution" | null;
  packageNotice: string | null;
  packageCautionNotice: string | null;
  source: string;
  retrieved: string;
}

const list = (names: readonly string[]) =>
  names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");

export function prepGate(source: string): PrepGate {
  const gate = taggingGate(source);
  const blocking = gate.incompatiblePackages.map((entry) => entry.name);
  const partial = gate.partialPackages.map((entry) => entry.name);
  const unproven = gate.unknownPackages.map((entry) => entry.name);
  const cautions = [
    partial.length > 0 ? `These packages only partly tag: ${list(partial)}.` : null,
    unproven.length > 0 ? `No tagging verdict is recorded for ${list(unproven)}.` : null,
  ].filter((part): part is string => part !== null);
  return {
    offer: !gate.blocked,
    classNotice: gate.blocked || gate.cautioned ? gate.reason : null,
    classSeverity: gate.blocked ? "block" : gate.cautioned ? "caution" : null,
    packageNotice:
      blocking.length > 0
        ? `These packages are not compatible with tagging: ${list(blocking)}. Content from ${blocking.length === 1 ? "it" : "them"} can land in the PDF untagged.`
        : null,
    packageCautionNotice:
      cautions.length > 0
        ? `${cautions.join(" ")} Compile and check the structure tree for gaps.`
        : null,
    source: gate.source,
    retrieved: gate.retrieved,
  };
}

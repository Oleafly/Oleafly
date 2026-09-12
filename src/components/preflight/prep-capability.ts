import { maskComments, message, taggingGate, type MessageRef } from "@oleafly/preflight";
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
  classNotice: MessageRef | null;
  classSeverity: "block" | "caution" | null;
  packageNotice: MessageRef | null;
  cautionNotices: MessageRef[];
  source: string;
  retrieved: string;
}

const listing = (names: readonly string[]) =>
  names.length > 4
    ? { packages: names.slice(0, 4).join(", "), more: names.length - 4 }
    : { packages: names.join(", "), more: 0 };

function packageNoticeFor(names: readonly string[]): MessageRef | null {
  if (names.length === 0) return null;
  const { packages, more } = listing(names);
  return more > 0
    ? message("gate.incompatiblePackagesTruncated", { packages, more })
    : message("gate.incompatiblePackages", { count: names.length, packages });
}

function cautionNoticeFor(
  names: readonly string[],
  base: "gate.partialPackages" | "gate.unknownPackages",
): MessageRef | null {
  if (names.length === 0) return null;
  const { packages, more } = listing(names);
  return more > 0 ? message(`${base}Truncated`, { packages, more }) : message(base, { packages });
}

function classSeverityFor(gate: ReturnType<typeof taggingGate>): "block" | "caution" | null {
  if (gate.blocked) return "block";
  if (gate.cautioned) return "caution";
  return null;
}

export function prepGate(source: string): PrepGate {
  const gate = taggingGate(source);
  const blocking = gate.incompatiblePackages.map((entry) => entry.name);
  const partial = gate.partialPackages.map((entry) => entry.name);
  const unproven = gate.unknownPackages.map((entry) => entry.name);
  const cautions = [
    cautionNoticeFor(partial, "gate.partialPackages"),
    cautionNoticeFor(unproven, "gate.unknownPackages"),
  ].filter((part): part is MessageRef => part !== null);
  return {
    offer: !gate.blocked,
    classNotice: gate.blocked || gate.cautioned ? gate.reason : null,
    classSeverity: classSeverityFor(gate),
    packageNotice: packageNoticeFor(blocking),
    cautionNotices: cautions.length > 0 ? [...cautions, message("gate.cautionAdvice")] : [],
    source: gate.source,
    retrieved: gate.retrieved,
  };
}

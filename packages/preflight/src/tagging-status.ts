import catalog from "./tagging-status.json";
import { maskComments } from "./mask";

export type TaggingCompatibility =
  | "compatible"
  | "partially-compatible"
  | "currently-incompatible"
  | "no-support"
  | "unchecked"
  | "unknown";

export interface TaggingStatusEntry {
  name: string;
  kind: "class" | "package";
  status: TaggingCompatibility;
  note?: string;
  updated?: string;
  restricted?: boolean;
}

export const TAGGING_STATUS_SOURCE = catalog.source;
export const TAGGING_STATUS_RETRIEVED = catalog.retrieved;
export const TAGGING_STATUS_LICENSE = catalog.license;

const STATUSES: TaggingCompatibility[] = [
  "compatible",
  "partially-compatible",
  "currently-incompatible",
  "no-support",
  "unchecked",
];

const RESTRICTIONS: Record<string, { status: TaggingCompatibility; note: string }> = {
  enumitem: {
    status: "currently-incompatible",
    note: "The LaTeX Project records enumitem as partly compatible, but a tagged build cannot load it right now, so Oleafly treats it as blocking.",
  },
};

const asStatus = (value: string): TaggingCompatibility =>
  (STATUSES as string[]).includes(value) ? (value as TaggingCompatibility) : "unknown";

const CLASSES = new Map<string, TaggingStatusEntry>(
  catalog.classes.map((entry) => [
    entry.name,
    {
      name: entry.name,
      kind: "class" as const,
      status: asStatus(entry.status),
      ...("note" in entry && entry.note ? { note: entry.note } : {}),
      ...("updated" in entry && entry.updated ? { updated: entry.updated } : {}),
    },
  ]),
);

const PACKAGES = new Map<string, TaggingCompatibility>();
for (const [status, names] of Object.entries(catalog.packages)) {
  for (const name of names) PACKAGES.set(name, asStatus(status));
}

export function classTaggingStatus(name: string): TaggingStatusEntry {
  return CLASSES.get(name) ?? { name, kind: "class", status: "unknown" };
}

export function packageTaggingStatus(name: string): TaggingStatusEntry {
  return { name, kind: "package", status: PACKAGES.get(name) ?? "unknown" };
}

export function packageTaggingVerdict(name: string): TaggingStatusEntry {
  const upstream = packageTaggingStatus(name);
  const restriction = RESTRICTIONS[name];
  if (!restriction) return upstream;
  return { ...upstream, status: restriction.status, note: restriction.note, restricted: true };
}

export function documentClassOf(source: string): string | null {
  const match = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(source);
  const name = match?.[1]?.trim();
  return name ? name : null;
}

export function loadedPackagesOf(source: string): string[] {
  const names = new Set<string>();
  const re = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

export interface TaggingGate {
  documentClass: TaggingStatusEntry | null;
  blocked: boolean;
  cautioned: boolean;
  reason: string | null;
  incompatiblePackages: TaggingStatusEntry[];
  partialPackages: TaggingStatusEntry[];
  unknownPackages: TaggingStatusEntry[];
  source: string;
  retrieved: string;
}

function classReason(entry: TaggingStatusEntry): string | null {
  if (entry.status === "no-support") {
    return `The ${entry.name} class cannot produce tagged output, and the LaTeX Project does not expect it to.${entry.note ? ` ${entry.note}` : ""}`;
  }
  if (entry.status === "currently-incompatible") {
    return `The ${entry.name} class is not compatible with LaTeX tagging yet, so preparing this source would not give you an accessible PDF.${entry.note ? ` ${entry.note}` : ""}`;
  }
  if (entry.status === "partially-compatible") {
    return `The ${entry.name} class is only partly compatible with tagging, so expect gaps in the structure tree.${entry.note ? ` ${entry.note}` : ""}`;
  }
  if (entry.status === "unchecked" || entry.status === "unknown") {
    return `The LaTeX Project has not recorded a tagging status for the ${entry.name} class, so the result is unproven. Compile and check the output.`;
  }
  return null;
}

export function taggingGate(source: string): TaggingGate {
  const masked = maskComments(source);
  const className = documentClassOf(masked);
  const documentClass = className ? classTaggingStatus(className) : null;
  const statuses = loadedPackagesOf(masked).map(packageTaggingVerdict);
  const blocked =
    documentClass !== null &&
    (documentClass.status === "no-support" || documentClass.status === "currently-incompatible");
  return {
    documentClass,
    blocked,
    cautioned:
      !blocked &&
      documentClass !== null &&
      documentClass.status !== "compatible",
    reason: documentClass ? classReason(documentClass) : null,
    incompatiblePackages: statuses.filter(
      (entry) => entry.status === "no-support" || entry.status === "currently-incompatible",
    ),
    partialPackages: statuses.filter((entry) => entry.status === "partially-compatible"),
    unknownPackages: statuses.filter(
      (entry) => entry.status === "unknown" || entry.status === "unchecked",
    ),
    source: TAGGING_STATUS_SOURCE,
    retrieved: TAGGING_STATUS_RETRIEVED,
  };
}

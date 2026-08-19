export const SUBMISSION_PROFILE_IDS = [
  "generic",
  "arxiv",
  "ieee",
  "acm",
  "journal",
  "thesis",
] as const;

export type SubmissionProfileId = (typeof SUBMISSION_PROFILE_IDS)[number];

export interface SubmissionProfile {
  id: SubmissionProfileId;
  label: string;
  description: string;
  source: {
    portableFileNames?: boolean;
    exactCasePaths?: boolean;
    allowedFigureExtensions?: readonly string[];
    recommendedDocumentClasses?: readonly string[];
    requireAbstract?: boolean;
    requireKeywords?: boolean;
  };
  pdf: {
    minimumVersion?: string;
    requireEmbeddedFonts?: boolean;
    forbidBookmarks?: boolean;
    forbidLinks?: boolean;
    forbidAttachments?: boolean;
    forbidRestrictions?: boolean;
  };
}

/**
 * Declarative profiles are deliberately data-only. A future registry adapter
 * can replace these bundled defaults without changing the rule engine.
 */
export const SUBMISSION_PROFILES: Record<SubmissionProfileId, SubmissionProfile> = {
  generic: {
    id: "generic",
    label: "General publication",
    description: "Portable source, clean output, complete metadata, and common publication risks.",
    source: { exactCasePaths: true, requireAbstract: true },
    pdf: {},
  },
  arxiv: {
    id: "arxiv",
    label: "arXiv",
    description: "Portable source that can be rebuilt on arXiv's case-sensitive submission system.",
    source: {
      portableFileNames: true,
      exactCasePaths: true,
      allowedFigureExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".ps", ".eps"],
      requireAbstract: true,
    },
    pdf: {},
  },
  ieee: {
    id: "ieee",
    label: "IEEE conference / journal",
    description: "IEEEtran source plus the PDF constraints checked for IEEE Xplore publication.",
    source: {
      exactCasePaths: true,
      recommendedDocumentClasses: ["IEEEtran"],
      requireAbstract: true,
      requireKeywords: true,
    },
    pdf: {
      minimumVersion: "1.4",
      requireEmbeddedFonts: true,
      forbidBookmarks: true,
      forbidLinks: true,
      forbidAttachments: true,
      forbidRestrictions: true,
    },
  },
  acm: {
    id: "acm",
    label: "ACM conference / journal",
    description: "ACM acmart source structure and publication-ready research metadata.",
    source: {
      exactCasePaths: true,
      recommendedDocumentClasses: ["acmart"],
      requireAbstract: true,
      requireKeywords: true,
    },
    pdf: { requireEmbeddedFonts: true },
  },
  journal: {
    id: "journal",
    label: "Other journal",
    description: "Publisher-neutral journal checks. Add the journal's exact limits before submission.",
    source: { exactCasePaths: true, requireAbstract: true },
    pdf: {},
  },
  thesis: {
    id: "thesis",
    label: "Thesis / dissertation",
    description: "Long-document structure, navigation, references, and portable source checks.",
    source: { exactCasePaths: true, requireAbstract: true },
    pdf: {},
  },
};

export function submissionProfile(id: SubmissionProfileId): SubmissionProfile {
  return SUBMISSION_PROFILES[id];
}

export function extractDocumentClass(source: string): string | null {
  const command = "\\documentclass";
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const commandAt = source.indexOf(command, searchFrom);
    if (commandAt < 0) return null;
    let cursor = commandAt + command.length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    if (source[cursor] === "[") {
      const optionsEnd = source.indexOf("]", cursor + 1);
      if (optionsEnd < 0) return null;
      cursor = optionsEnd + 1;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    }
    if (source[cursor] === "{") {
      const classEnd = source.indexOf("}", cursor + 1);
      if (classEnd < 0) return null;
      return source.slice(cursor + 1, classEnd).trim() || null;
    }
    searchFrom = commandAt + command.length;
  }
  return null;
}

export function detectSubmissionProfile(source: string): SubmissionProfileId {
  const className = extractDocumentClass(source)?.toLowerCase();
  if (className === "ieeetran") return "ieee";
  if (className === "acmart") return "acm";
  if (className && /(?:thesis|dissertation|memoir|book)/.test(className)) return "thesis";
  return "generic";
}

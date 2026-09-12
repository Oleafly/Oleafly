import { maskComments } from "./mask";
import {
  extractDocumentClass,
  submissionProfile,
  type SubmissionProfile,
  type SubmissionProfileId,
} from "./profiles";
import { message, type MessageRef } from "./messages";
import type { Finding, PdfFacts, ProjectContext, ProjectFile } from "./types";

const SOURCE_EXTENSIONS = new Set([".tex", ".ltx", ".sty", ".cls"]);
const GRAPHICS_EXTENSIONS = ["", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".ps", ".eps", ".svg"];
const INPUT_EXTENSIONS = ["", ".tex"];
const PORTABLE_NAME = /^[A-Za-z0-9_+.,=/-]+$/;
const GENERATED_FILE = /(?:^|\/)(?:[^/]+\.(?:aux|log|out|toc|fls|fdb_latexmk|synctex(?:\.gz)?))$/i;
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

function extension(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function directory(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function isSensitiveFile(path: string): boolean {
  const name = (normalize(path).split("/").pop() ?? "").toLowerCase();
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    SENSITIVE_EXTENSIONS.has(extension(name))
  );
}

function referencedCandidates(sourceFile: string, target: string, extensions: readonly string[]): string[] {
  const clean = target.trim().replace(/^\{?|\}?$/g, "");
  const bases = clean.startsWith("/") ? [clean] : [directory(sourceFile) + clean, clean];
  return [...new Set(bases.flatMap((base) => extensions.map((ext) => normalize(base + ext))))];
}

function make(
  id: string,
  lens: Finding["lens"],
  severity: Finding["severity"],
  title: MessageRef,
  detail: MessageRef,
  file?: string,
  certainty: Finding["certainty"] = "verified",
): Finding {
  return { id, lens, severity, title, detail, file, certainty };
}

function sourceFiles(project: ProjectContext): ProjectFile[] {
  return project.files.filter((file) => file.content !== undefined && SOURCE_EXTENSIONS.has(extension(file.path)));
}

function sourceCorpus(project: ProjectContext): string {
  return sourceFiles(project).map((file) => maskComments(file.content ?? "")).join("\n");
}

function documentClass(source: string): string | null {
  return extractDocumentClass(source);
}

function checkProjectReferences(project: ProjectContext, profileId: SubmissionProfileId): Finding[] {
  const profile = submissionProfile(profileId);
  if (!profile.source.exactCasePaths) return [];
  const out: Finding[] = [];
  const paths = project.files.map((file) => normalize(file.path));
  const exact = new Set(paths);
  const folded = new Map(paths.map((path) => [path.toLowerCase(), path]));

  const inspect = (
    file: ProjectFile,
    expression: RegExp,
    extensions: readonly string[],
    kind: "Figure" | "Include",
  ) => {
    const content = maskComments(file.content ?? "");
    let match: RegExpExecArray | null;
    const re = new RegExp(expression.source, "g");
    while ((match = re.exec(content))) {
      const target = match[1].trim();
      if (/^(?:https?:|data:)/i.test(target)) continue;
      const candidates = referencedCandidates(file.path, target, extensions);
      if (candidates.some((candidate) => exact.has(candidate))) continue;
      const caseMatch = candidates.map((candidate) => folded.get(candidate.toLowerCase())).find(Boolean);
      if (caseMatch) {
        out.push(
          make(
            "submission-path-case",
            "submission",
            "error",
            message("rules.submission-path-case.title", { target }),
            message(`rules.submission-path-case.detail${kind}`, { match: caseMatch }),
            file.path,
          ),
        );
      } else {
        out.push(
          make(
            "submission-missing-project-file",
            "submission",
            "error",
            message(`rules.submission-missing-project-file.title${kind}`, { target }),
            message("rules.submission-missing-project-file.detail", { file: file.path }),
            file.path,
          ),
        );
      }
    }
  };

  for (const file of sourceFiles(project)) {
    inspect(file, /\\includegraphics\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/, GRAPHICS_EXTENSIONS, "Figure");
    inspect(file, /\\(?:input|include)\s*\{([^}]*)\}/, INPUT_EXTENSIONS, "Include");
  }
  return out;
}

function checkFiguresAndTables(project: ProjectContext): Finding[] {
  const out: Finding[] = [];
  for (const file of sourceFiles(project)) {
    const content = maskComments(file.content ?? "");
    const env = /\\begin\{(figure\*?|table\*?)\}([\s\S]*?)\\end\{\1\}/g;
    let match: RegExpExecArray | null;
    while ((match = env.exec(content))) {
      const body = match[2];
      if (!/\\caption(?:\[[^\]]*\])?\s*\{/.test(body)) {
        out.push(
          make(
            "submission-missing-caption",
            "submission",
            "warning",
            message(
              match[1].replaceAll("*", "") === "table"
                ? "rules.submission-missing-caption.titleTable"
                : "rules.submission-missing-caption.titleFigure",
            ),
            message("rules.submission-missing-caption.detail"),
            file.path,
          ),
        );
      }
      const labelAt = body.search(/\\label\s*\{/);
      const captionAt = body.search(/\\caption(?:\[[^\]]*\])?\s*\{/);
      if (labelAt >= 0 && captionAt >= 0 && labelAt < captionAt) {
        out.push(
          make(
            "submission-label-before-caption",
            "refs",
            "warning",
            message("rules.submission-label-before-caption.title"),
            message("rules.submission-label-before-caption.detail"),
            file.path,
          ),
        );
      }
    }
  }
  return out;
}

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
];

const INTERNAL_COMMENT_TERMS =
  /\b(?:TODO|FIXME|CONFIDENTIAL|INTERNAL ONLY|DO NOT DISTRIBUTE)\b/i;
const SOURCE_LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/u;

function hasInternalComment(content: string): boolean {
  for (const line of content.split(SOURCE_LINE_BREAK)) {
    const start = line.search(/\S/u);
    if (start === -1 || line[start] !== "%") continue;
    if (INTERNAL_COMMENT_TERMS.test(line)) return true;
  }
  return false;
}

function filePrivacyFindings(file: ProjectContext["files"][number]): Finding[] {
  const out: Finding[] = [];
  if (isSensitiveFile(file.path)) {
    out.push(
      make(
        "privacy-sensitive-file",
        "privacy",
        "error",
        message("rules.privacy-sensitive-file.title", { file: file.path }),
        message("rules.privacy-sensitive-file.detail"),
        file.path,
      ),
    );
  }
  const content = file.content ?? "";
  if (!content) return out;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    out.push(
      make(
        "privacy-credential",
        "privacy",
        "error",
        message("rules.privacy-credential.title", { file: file.path }),
        message("rules.privacy-credential.detail"),
        file.path,
      ),
    );
  }
  if (hasInternalComment(content)) {
    out.push(
      make(
        "privacy-internal-comment",
        "privacy",
        "warning",
        message("rules.privacy-internal-comment.title", { file: file.path }),
        message("rules.privacy-internal-comment.detail"),
        file.path,
        "advisory",
      ),
    );
  }
  return out;
}

function blindReviewFindings(source: string, pdf: PdfFacts | undefined): Finding[] {
  const out: Finding[] = [];
  const authorSource = /\\(?:author|IEEEauthorblockN|affiliation|address|email|thanks)\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/gi;
  const identifying = [...source.matchAll(authorSource)].some((match) => !/anonymous|omitted|blind review/i.test(match[1]));
  if (identifying) {
    out.push(
      make(
        "privacy-blind-author",
        "privacy",
        "error",
        message("rules.privacy-blind-author.title"),
        message("rules.privacy-blind-author.detail"),
      ),
    );
  }
  if (/\\(?:section\*?|begin)\s*\{?acknowledg/i.test(source)) {
    out.push(
      make(
        "privacy-blind-acknowledgements",
        "privacy",
        "warning",
        message("rules.privacy-blind-acknowledgements.title"),
        message("rules.privacy-blind-acknowledgements.detail"),
        undefined,
        "advisory",
      ),
    );
  }
  if (pdf?.author && !/anonymous|omitted|blind review/i.test(pdf.author)) {
    out.push(
      make(
        "privacy-pdf-author",
        "privacy",
        "error",
        message("rules.privacy-pdf-author.title"),
        message("rules.privacy-pdf-author.detail", { author: pdf.author }),
      ),
    );
  }
  return out;
}

function checkPrivacy(project: ProjectContext, pdf: PdfFacts | undefined, anonymousReview: boolean): Finding[] {
  const out: Finding[] = project.files.flatMap(filePrivacyFindings);

  const source = sourceCorpus(project);
  const draftArtifact = /\\usepackage(?:\[[^\]]*\])?\{(?:draftwatermark|todonotes|showkeys|changes)\}|\\todo\s*\{|\\documentclass\s*\[[^\]]*\bdraft\b/i.exec(source);
  if (draftArtifact) {
    out.push(
      make(
        "privacy-draft-artifact",
        "privacy",
        "warning",
        message("rules.privacy-draft-artifact.title"),
        message("rules.privacy-draft-artifact.detail"),
        undefined,
        "advisory",
      ),
    );
  }

  if (anonymousReview) {
    out.push(...blindReviewFindings(source, pdf));
  }
  return out;
}

export interface SubmissionRuleInput {
  project: ProjectContext;
  profileId: SubmissionProfileId;
  pdf?: PdfFacts;
  anonymousReview?: boolean;
}

function portableNameFindings(project: ProjectContext): Finding[] {
  const out: Finding[] = [];
  for (const file of project.files) {
    if (!PORTABLE_NAME.test(file.path)) {
      out.push(
        make(
          "submission-nonportable-filename",
          "submission",
          "error",
          message("rules.submission-nonportable-filename.title", { file: file.path }),
          message("rules.submission-nonportable-filename.detail"),
          file.path,
        ),
      );
    }
  }
  return out;
}

function sourceHygieneFindings(project: ProjectContext): Finding[] {
  const out: Finding[] = [];
  for (const file of sourceFiles(project)) {
    const content = maskComments(file.content ?? "");
    if (/(?:^|[={\s])(?:\/[A-Za-z0-9._-]+){2,}|[A-Za-z]:\\[^\s}\]]+/m.test(content)) {
      out.push(
        make(
          "submission-absolute-path",
          "submission",
          "error",
          message("rules.submission-absolute-path.title", { file: file.path }),
          message("rules.submission-absolute-path.detail"),
          file.path,
        ),
      );
    }
    if (/\\(?:immediate\s*)?write18\b|\\ShellEscape\b|\\usepackage(?:\[[^\]]*\])?\{(?:minted|pythontex|sagetex)\}/i.test(content)) {
      out.push(
        make(
          "submission-shell-escape",
          "submission",
          "warning",
          message("rules.submission-shell-escape.title", { file: file.path }),
          message("rules.submission-shell-escape.detail"),
          file.path,
          "advisory",
        ),
      );
    }
  }
  return out;
}

function generatedFileFindings(project: ProjectContext): Finding[] {
  const out: Finding[] = [];
  for (const file of project.files) {
    if (GENERATED_FILE.test(file.path)) {
      out.push(
        make(
          "submission-generated-file",
          "submission",
          "info",
          message("rules.submission-generated-file.title", { file: file.path }),
          message("rules.submission-generated-file.detail"),
          file.path,
          "advisory",
        ),
      );
    }
  }
  return out;
}

function documentClassFinding(source: string, profile: SubmissionProfile): Finding | null {
  const dc = documentClass(source);
  const recommended = profile.source.recommendedDocumentClasses;
  if (!recommended) return null;
  if (dc && recommended.some((name) => name.toLowerCase() === dc.toLowerCase())) return null;
  return make(
    "submission-document-class",
    "submission",
    "error",
    message("rules.submission-document-class.title", { profile: profile.label }),
    dc
      ? message("rules.submission-document-class.detail", {
          expected: recommended.join(" or "),
          actual: dc,
        })
      : message("rules.submission-document-class.detailNoClass", {
          expected: recommended.join(" or "),
        }),
  );
}

function documentStructureFindings(source: string, profile: SubmissionProfile): Finding[] {
  const out: Finding[] = [];
  const classFinding = documentClassFinding(source, profile);
  if (classFinding) out.push(classFinding);
  if (profile.source.requireAbstract && !/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/i.test(source)) {
    out.push(
      make(
        "submission-no-abstract",
        "submission",
        "warning",
        message("rules.submission-no-abstract.title"),
        message("rules.submission-no-abstract.detail"),
        undefined,
        "advisory",
      ),
    );
  }
  if (profile.source.requireKeywords && !/\\keywords\s*\{|\\begin\{IEEEkeywords\}/i.test(source)) {
    out.push(
      make(
        "submission-no-keywords",
        "submission",
        "warning",
        message("rules.submission-no-keywords.title"),
        message("rules.submission-no-keywords.detail", { profile: profile.label }),
        undefined,
        "advisory",
      ),
    );
  }
  return out;
}

function figureFormatFindings(
  project: ProjectContext,
  profile: SubmissionProfile,
  allowedFigures: readonly string[],
): Finding[] {
  const out: Finding[] = [];
  for (const file of sourceFiles(project)) {
    const content = maskComments(file.content ?? "");
    for (const match of content.matchAll(/\\includegraphics\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
      const ext = extension(match[1].trim());
      if (ext && !allowedFigures.includes(ext)) {
        out.push(
          make(
            "submission-figure-format",
            "submission",
            "error",
            message("rules.submission-figure-format.title", { file: match[1].trim() }),
            message("rules.submission-figure-format.detail", {
              profile: profile.label,
              formats: allowedFigures.join(", "),
            }),
            file.path,
          ),
        );
      }
    }
  }
  return out;
}

export function runSubmissionRules({
  project,
  profileId,
  pdf,
  anonymousReview = false,
}: SubmissionRuleInput): Finding[] {
  const profile = submissionProfile(profileId);
  const source = sourceCorpus(project);
  const allowedFigures = profile.source.allowedFigureExtensions;
  const out: Finding[] = [
    ...(profile.source.portableFileNames ? portableNameFindings(project) : []),
    ...sourceHygieneFindings(project),
    ...generatedFileFindings(project),
    ...documentStructureFindings(source, profile),
    ...(allowedFigures ? figureFormatFindings(project, profile, allowedFigures) : []),
  ];

  if (/\b(?:TODO|TBD|FIXME|Lorem ipsum)\b|\?\?+/i.test(source)) {
    out.push(
      make(
        "submission-placeholder",
        "submission",
        "warning",
        message("rules.submission-placeholder.title"),
        message("rules.submission-placeholder.detail"),
        undefined,
        "advisory",
      ),
    );
  }

  if (pdf) {
    const minimum = profile.pdf.minimumVersion;
    if (minimum && pdf.version && Number(pdf.version) < Number(minimum)) {
      out.push(
        make(
          "submission-pdf-version",
          "submission",
          "error",
          message("rules.submission-pdf-version.title", { version: pdf.version }),
          message("rules.submission-pdf-version.detail", { profile: profile.label, minimum }),
        ),
      );
    }
    if (profile.pdf.forbidBookmarks && pdf.outlineCount > 0) {
      out.push(
        make(
          "submission-bookmarks",
          "submission",
          "error",
          message("rules.submission-bookmarks.title"),
          message("rules.submission-bookmarks.detail", { profile: profile.label }),
        ),
      );
    }
    if (profile.pdf.forbidLinks && pdf.linkCount > 0) {
      out.push(
        make(
          "submission-links",
          "submission",
          "error",
          message("rules.submission-links.title"),
          message("rules.submission-links.detail", { profile: profile.label }),
        ),
      );
    }
    if (profile.pdf.forbidAttachments && pdf.attachmentCount > 0) {
      out.push(
        make(
          "submission-attachments",
          "submission",
          "error",
          message("rules.submission-attachments.title"),
          message("rules.submission-attachments.detail", { profile: profile.label }),
        ),
      );
    }
    if (profile.pdf.forbidRestrictions && pdf.restricted === true) {
      out.push(
        make(
          "submission-security",
          "submission",
          "error",
          message("rules.submission-security.title"),
          message("rules.submission-security.detail", { profile: profile.label }),
        ),
      );
    }
    if (profile.pdf.requireEmbeddedFonts) {
      const unembedded = pdf.fonts.filter((font) => font.embedded === false);
      const unknown = pdf.fonts.filter((font) => font.embedded === null);
      if (unembedded.length > 0) {
        out.push(
          make(
            "submission-unembedded-font",
            "submission",
            "error",
            message("rules.submission-unembedded-font.title", { count: unembedded.length }),
            message("rules.submission-unembedded-font.detail", {
              profile: profile.label,
              fonts: unembedded.slice(0, 6).map((font) => font.name).join(", "),
            }),
          ),
        );
      } else if (unknown.length > 0) {
        out.push(
          make(
            "submission-font-inspection-incomplete",
            "submission",
            "info",
            message("rules.submission-font-inspection-incomplete.title"),
            message("rules.submission-font-inspection-incomplete.detail", {
              fonts: unknown.slice(0, 6).map((font) => font.name).join(", "),
            }),
            undefined,
            "manual",
          ),
        );
      }
    }
  }

  out.push(
    ...checkProjectReferences(project, profileId),
    ...checkFiguresAndTables(project),
    ...checkPrivacy(project, pdf, anonymousReview),
  );
  return out;
}

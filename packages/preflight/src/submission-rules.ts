import { maskComments } from "./mask";
import { extractDocumentClass, submissionProfile, type SubmissionProfileId } from "./profiles";
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
  for (const part of path.replace(/\\/g, "/").split("/")) {
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
  title: string,
  detail: string,
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
    kind: "figure" | "included file",
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
            `Filename case does not match: ${target}`,
            `This ${kind} resolves only on a case-insensitive filesystem. The project contains "${caseMatch}", so match that capitalization exactly before submitting to Linux-based build systems.`,
            file.path,
          ),
        );
      } else {
        out.push(
          make(
            "submission-missing-project-file",
            "submission",
            "error",
            `Missing ${kind}: ${target}`,
            `No project file resolves this reference from ${file.path}. A clean submission build will fail even if a local cache currently lets the document compile.`,
            file.path,
          ),
        );
      }
    }
  };

  for (const file of sourceFiles(project)) {
    inspect(file, /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/, GRAPHICS_EXTENSIONS, "figure");
    inspect(file, /\\(?:input|include)\s*\{([^}]*)\}/, INPUT_EXTENSIONS, "included file");
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
            `${match[1].replaceAll("*", "")} without a caption`,
            "Publication figures and tables should have a numbered, descriptive caption so they can be referenced and understood independently.",
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
            "Label appears before its caption",
            "Place the label after the caption. Otherwise LaTeX can bind it to the previous counter and produce the wrong figure or table number.",
            file.path,
          ),
        );
      }
    }
  }
  return out;
}

function checkPrivacy(project: ProjectContext, pdf: PdfFacts | undefined, anonymousReview: boolean): Finding[] {
  const out: Finding[] = [];

  for (const file of project.files) {
    if (isSensitiveFile(file.path)) {
      out.push(
        make(
          "privacy-sensitive-file",
          "privacy",
          "error",
          `Sensitive file included: ${file.path}`,
          "Remove credentials and private-key files from the project before exporting, syncing, or publishing the source archive.",
          file.path,
        ),
      );
    }
    const content = file.content ?? "";
    if (!content) continue;
    const secretPatterns = [
      /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
    ];
    if (secretPatterns.some((pattern) => pattern.test(content))) {
      out.push(
        make(
          "privacy-credential",
          "privacy",
          "error",
          `Possible credential in ${file.path}`,
          "The project contains text shaped like an API token, cloud access key, or private key. Revoke exposed credentials, then remove them from the project and its Git history.",
          file.path,
        ),
      );
    }
    if (/^\s*%.*\b(?:TODO|FIXME|CONFIDENTIAL|INTERNAL ONLY|DO NOT DISTRIBUTE)\b/im.test(content)) {
      out.push(
        make(
          "privacy-internal-comment",
          "privacy",
          "warning",
          `Internal note remains in ${file.path}`,
          "Source comments are not visible in the PDF but may be public in a conference, journal, or preprint source archive. Review and remove private editorial notes.",
          file.path,
          "advisory",
        ),
      );
    }
  }

  const source = sourceCorpus(project);
  const draftArtifact = /\\usepackage(?:\[[^\]]*\])?\{(?:draftwatermark|todonotes|showkeys|changes)\}|\\todo\s*\{|\\documentclass\s*\[[^\]]*\bdraft\b/i.exec(source);
  if (draftArtifact) {
    out.push(
      make(
        "privacy-draft-artifact",
        "privacy",
        "warning",
        "Draft markup is still enabled",
        "The source enables draft, TODO, change-tracking, watermark, or label-debugging output. Disable it and visually inspect the final PDF before submission.",
        undefined,
        "advisory",
      ),
    );
  }

  if (anonymousReview) {
    const authorSource = /\\(?:author|IEEEauthorblockN|affiliation|address|email|thanks)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/gi;
    const identifying = [...source.matchAll(authorSource)].find((match) => !/anonymous|omitted|blind review/i.test(match[1]));
    if (identifying) {
      out.push(
        make(
          "privacy-blind-author",
          "privacy",
          "error",
          "Author identity remains in blind-review source",
          "The source contains a non-anonymous author, affiliation, email, address, or thanks field. Replace identifying content using the venue's anonymous-review mode.",
        ),
      );
    }
    if (/\\(?:section\*?|begin)\s*\{?acknowledg/i.test(source)) {
      out.push(
        make(
          "privacy-blind-acknowledgements",
          "privacy",
          "warning",
          "Acknowledgements may reveal the authors",
          "Acknowledgements commonly identify institutions, grants, collaborators, or facilities. Remove them from a blind-review submission unless the venue explicitly permits them.",
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
          "PDF metadata identifies an author",
          `The PDF Author field is "${pdf.author}". Clear author metadata before uploading a blind-review PDF.`,
        ),
      );
    }
  }
  return out;
}

export interface SubmissionRuleInput {
  project: ProjectContext;
  profileId: SubmissionProfileId;
  pdf?: PdfFacts;
  anonymousReview?: boolean;
}

export function runSubmissionRules({
  project,
  profileId,
  pdf,
  anonymousReview = false,
}: SubmissionRuleInput): Finding[] {
  const profile = submissionProfile(profileId);
  const source = sourceCorpus(project);
  const out: Finding[] = [];

  if (profile.source.portableFileNames) {
    for (const file of project.files) {
      if (!PORTABLE_NAME.test(file.path)) {
        out.push(
          make(
            "submission-nonportable-filename",
            "submission",
            "error",
            `Non-portable filename: ${file.path}`,
            "This profile permits only letters, numbers, underscores, plus, minus, dots, commas, equals signs, and directory separators. Rename the file and update its references.",
            file.path,
          ),
        );
      }
    }
  }

  for (const file of sourceFiles(project)) {
    const content = maskComments(file.content ?? "");
    if (/(?:^|[={\s])(?:\/[A-Za-z0-9._-]+){2,}|[A-Za-z]:\\[^\s}\]]+/m.test(content)) {
      out.push(
        make(
          "submission-absolute-path",
          "submission",
          "error",
          `Machine-specific path in ${file.path}`,
          "Absolute local paths do not exist on publisher build servers. Move the dependency into the project and reference it with a relative path.",
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
          `External command execution required by ${file.path}`,
          "Many publisher and archive builders disable shell escape. Pre-generate the output or confirm that the target venue supports this package and command.",
          file.path,
          "advisory",
        ),
      );
    }
  }

  for (const file of project.files) {
    if (GENERATED_FILE.test(file.path)) {
      out.push(
        make(
          "submission-generated-file",
          "submission",
          "info",
          `Generated build file included: ${file.path}`,
          "Generated auxiliary files make source packages noisy and can preserve stale state. Exclude them unless the selected venue explicitly requires that file.",
          file.path,
          "advisory",
        ),
      );
    }
  }

  const dc = documentClass(source);
  const recommended = profile.source.recommendedDocumentClasses;
  if (recommended && (!dc || !recommended.some((name) => name.toLowerCase() === dc.toLowerCase()))) {
    out.push(
      make(
        "submission-document-class",
        "submission",
        "error",
        `${profile.label} document class is not active`,
        `This profile expects ${recommended.join(" or ")}, but the project uses ${dc ?? "no detected document class"}. Start from the venue's current official template.`,
      ),
    );
  }
  if (profile.source.requireAbstract && !/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/i.test(source)) {
    out.push(
      make(
        "submission-no-abstract",
        "submission",
        "warning",
        "No abstract detected",
        "This publication profile expects an abstract in a standard abstract environment. Add it or confirm that the specific venue does not require one.",
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
        "No publication keywords detected",
        `The ${profile.label} profile expects keywords using its standard template command or environment.`,
        undefined,
        "advisory",
      ),
    );
  }

  const allowedFigures = profile.source.allowedFigureExtensions;
  if (allowedFigures) {
    for (const file of sourceFiles(project)) {
      const content = maskComments(file.content ?? "");
      for (const match of content.matchAll(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
        const ext = extension(match[1].trim());
        if (ext && !allowedFigures.includes(ext)) {
          out.push(
            make(
              "submission-figure-format",
              "submission",
              "error",
              `Unsupported figure format: ${match[1].trim()}`,
              `${profile.label} accepts ${allowedFigures.join(", ")} figure files for its supported TeX workflows. Convert this figure before upload.`,
              file.path,
            ),
          );
        }
      }
    }
  }

  if (/\b(?:TODO|TBD|FIXME|Lorem ipsum)\b|\?\?+/i.test(source)) {
    out.push(
      make(
        "submission-placeholder",
        "submission",
        "warning",
        "Draft placeholder remains in the manuscript",
        "The source contains TODO, TBD, FIXME, placeholder copy, or question-mark markers. Review each occurrence before producing the final submission.",
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
          `PDF ${pdf.version} is below the required version`,
          `${profile.label} requires PDF ${minimum} or later. Update the compiler PDF settings and regenerate the file.`,
        ),
      );
    }
    if (profile.pdf.forbidBookmarks && pdf.outlineCount > 0) {
      out.push(make("submission-bookmarks", "submission", "error", "PDF bookmarks are not permitted", `${profile.label} rejects PDF bookmarks. Remove the document outline for this submission profile.`));
    }
    if (profile.pdf.forbidLinks && pdf.linkCount > 0) {
      out.push(make("submission-links", "submission", "error", "PDF links are not permitted", `${profile.label} rejects link annotations. Disable generated hyperlinks for the submitted PDF.`));
    }
    if (profile.pdf.forbidAttachments && pdf.attachmentCount > 0) {
      out.push(make("submission-attachments", "submission", "error", "PDF contains embedded attachments", `${profile.label} rejects PDF attachments and packages. Remove all embedded files before submission.`));
    }
    if (profile.pdf.forbidRestrictions && pdf.restricted === true) {
      out.push(make("submission-security", "submission", "error", "PDF security restrictions are enabled", `${profile.label} requires a PDF without password or permission restrictions.`));
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
            `${unembedded.length} font${unembedded.length === 1 ? " is" : "s are"} not embedded`,
            `${profile.label} requires every font to be embedded or subset so text and mathematics render reliably. Fix ${unembedded.slice(0, 6).map((font) => font.name).join(", ")}.`,
          ),
        );
      } else if (unknown.length > 0) {
        out.push(
          make(
            "submission-font-inspection-incomplete",
            "submission",
            "info",
            "Some font embedding could not be verified",
            `Preflight could not prove the embedding status of ${unknown.slice(0, 6).map((font) => font.name).join(", ")}. Confirm them with the venue's official PDF checker.`,
            undefined,
            "manual",
          ),
        );
      }
    }
  }

  out.push(...checkProjectReferences(project, profileId));
  out.push(...checkFiguresAndTables(project));
  out.push(...checkPrivacy(project, pdf, anonymousReview));
  return out;
}

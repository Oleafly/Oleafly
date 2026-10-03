import { message, type MessageRef } from "./messages";
import {
  SUBMISSION_PROFILES,
  extractTypstTemplates,
  submissionProfile,
  type SubmissionProfile,
  type SubmissionProfileId,
} from "./profiles";
import {
  INTERNAL_COMMENT_TERMS,
  filePrivacyFindings,
  generatedFileFindings,
  hasInternalComment,
  pdfAuthorFindings,
  pdfSubmissionFindings,
  portableNameFindings,
} from "./submission-rules";
import { typstPathReferences, typstTemplateCalls } from "./typst-references";
import {
  type TypstCall,
  type TypstScan,
  TYPST_MARKUP,
  isBlankValue,
  isExternalTypstPath,
  namedArgument,
  normalizeProjectPath,
  positionalArgument,
  resolveTypstPath,
  scanTypst,
  typstCalls,
} from "./typst-scan";
import type { Finding, PdfFacts, ProjectContext, ProjectFile } from "./types";

export const LARGE_IMAGE_BYTES = 5 * 1024 * 1024;
const LARGE_IMAGE_LABEL = "5 MB";

export interface TypstSubmissionRuleInput {
  project: ProjectContext;
  profileId: SubmissionProfileId;
  pdf?: PdfFacts;
  anonymousReview?: boolean;
}

interface ScannedFile {
  readonly path: string;
  readonly scan: TypstScan;
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

const isTypstFile = (path: string) => /\.typ$/i.test(path);

function typstFiles(project: ProjectContext): ScannedFile[] {
  return project.files
    .filter((file) => file.content !== undefined && isTypstFile(file.path))
    .map((file) => ({ path: file.path, scan: scanTypst(file.content ?? "") }));
}

function markupLines(scan: TypstScan, pattern: RegExp): boolean {
  let offset = 0;
  for (const line of scan.masked.split("\n")) {
    const match = pattern.exec(line);
    if (match && scan.kinds[offset + match.index + (match[1]?.length ?? 0)] === TYPST_MARKUP) return true;
    offset += line.length + 1;
  }
  return false;
}

function codeMentions(scans: readonly ScannedFile[], pattern: RegExp): boolean {
  return scans.some(({ scan }) => pattern.test(scan.code));
}

function templateFinding(scans: readonly ScannedFile[], profile: SubmissionProfile): Finding | null {
  const recommended = profile.source.recommendedTypstTemplates;
  if (!recommended) return null;
  const imported = scans.flatMap(({ scan }) => extractTypstTemplates(scan.masked));
  if (imported.some((name) => recommended.includes(name))) return null;
  const known = new Set(
    Object.values(SUBMISSION_PROFILES).flatMap((item) => item.source.recommendedTypstTemplates ?? []),
  );
  const actual = imported.find((name) => known.has(name));
  const expected = recommended.join(" or ");
  return make(
    "submission-document-class",
    "submission",
    "warning",
    message("rules.submission-document-class.titleTypst", { profile: profile.label }),
    actual
      ? message("rules.submission-document-class.detailTypst", { expected, actual })
      : message("rules.submission-document-class.detailNoTemplateTypst", { expected }),
    undefined,
    "advisory",
  );
}

function structureFindings(scans: readonly ScannedFile[], profile: SubmissionProfile): Finding[] {
  const out: Finding[] = [];
  const template = templateFinding(scans, profile);
  if (template) out.push(template);
  const hasAbstract =
    codeMentions(scans, /(?<![\p{L}\p{N}_.-])abstract[\p{L}\p{N}_-]*\s*(?::(?!\s*(?:\(\s*\)|none\b))|[([])/u) ||
    scans.some(({ scan }) => markupLines(scan, /^([ \t]*)=+[ \t]+Abstract\b/i));
  if (profile.source.requireAbstract && !hasAbstract) {
    out.push(
      make(
        "submission-no-abstract",
        "submission",
        "warning",
        message("rules.submission-no-abstract.title"),
        message("rules.submission-no-abstract.detailTypst"),
        undefined,
        "advisory",
      ),
    );
  }
  const hasKeywords =
    codeMentions(
      scans,
      /(?<![\p{L}\p{N}_.-])(?:keywords|index-terms)\s*:(?!\s*(?:\(\s*\)|none\b))|(?<![\p{L}\p{N}_.-])[\p{L}-]*keywords\s*\(/u,
    ) || scans.some(({ scan }) => markupLines(scan, /^([ \t]*)(?:=+[ \t]+)?(?:Keywords|Index Terms)\b/i));
  if (profile.source.requireKeywords && !hasKeywords) {
    out.push(
      make(
        "submission-no-keywords",
        "submission",
        "warning",
        message("rules.submission-no-keywords.title"),
        message("rules.submission-no-keywords.detailTypst", { profile: profile.label }),
        undefined,
        "advisory",
      ),
    );
  }
  return out;
}

function placeholderFindings(scans: readonly ScannedFile[]): Finding[] {
  const placeholder = scans.some(
    ({ scan }) => /(?<![\p{L}\p{N}_.-])lorem\s*\(/u.test(scan.code) || /\blorem ipsum\b/i.test(scan.markup),
  );
  if (!placeholder) return [];
  return [
    make(
      "submission-placeholder",
      "submission",
      "warning",
      message("rules.submission-placeholder.title"),
      message("rules.submission-placeholder.detailTypst"),
      undefined,
      "advisory",
    ),
  ];
}

function pathFindings(scans: readonly ScannedFile[], project: ProjectContext, profile: SubmissionProfile): Finding[] {
  if (!profile.source.exactCasePaths) return [];
  const paths = project.files.map((file) => normalizeProjectPath(file.path) ?? file.path);
  const exact = new Set(paths);
  const folded = new Map(paths.map((path) => [path.toLowerCase(), path]));
  const out: Finding[] = [];
  for (const { path, scan } of scans) {
    for (const reference of typstPathReferences(scan)) {
      if (reference.kind !== "image" && reference.kind !== "include") continue;
      if (isExternalTypstPath(reference.raw)) continue;
      const resolved = resolveTypstPath(path, reference.raw);
      if (resolved !== null && exact.has(resolved)) continue;
      const kind = reference.kind === "image" ? "Figure" : "Include";
      const caseMatch = resolved === null ? undefined : folded.get(resolved.toLowerCase());
      out.push(
        caseMatch
          ? make(
              "submission-path-case",
              "submission",
              "error",
              message("rules.submission-path-case.title", { target: reference.raw }),
              message(`rules.submission-path-case.detail${kind}`, { match: caseMatch }),
              path,
            )
          : make(
              "submission-missing-project-file",
              "submission",
              "error",
              message(`rules.submission-missing-project-file.title${kind}`, { target: reference.raw }),
              message("rules.submission-missing-project-file.detail", { file: path }),
              path,
            ),
      );
    }
  }
  return out;
}

function isTableFigure(scan: TypstScan, call: TypstCall): boolean {
  const kind = namedArgument(call, "kind");
  if (kind && /^table\b/.test(scan.code.slice(kind.valueFrom, kind.valueTo))) return true;
  const body = positionalArgument(scan, call);
  if (!body) return false;
  const code = scan.code.slice(body.valueFrom, body.valueTo);
  if (/^table\s*\(/.test(code)) return true;
  return code.startsWith("[") && /^\s*#table\s*\(/.test(scan.text.slice(body.valueFrom + 1, body.valueTo));
}

function captionFindings(scans: readonly ScannedFile[]): Finding[] {
  const out: Finding[] = [];
  for (const { path, scan } of scans) {
    for (const figure of typstCalls(scan, ["figure"])) {
      const caption = namedArgument(figure, "caption");
      if (caption && !isBlankValue(scan, caption.valueFrom, caption.valueTo)) continue;
      out.push(
        make(
          "submission-missing-caption",
          "submission",
          "warning",
          message(
            isTableFigure(scan, figure)
              ? "rules.submission-missing-caption.titleTable"
              : "rules.submission-missing-caption.titleFigure",
          ),
          message("rules.submission-missing-caption.detail"),
          path,
        ),
      );
    }
  }
  return out;
}

function referencedImageFiles(scans: readonly ScannedFile[], files: readonly ProjectFile[]): ProjectFile[] {
  const byLower = new Map(files.map((file) => [(normalizeProjectPath(file.path) ?? file.path).toLowerCase(), file]));
  const seen = new Set<ProjectFile>();
  for (const { path, scan } of scans) {
    for (const reference of typstPathReferences(scan)) {
      if (reference.kind !== "image") continue;
      const resolved = resolveTypstPath(path, reference.raw);
      const file = resolved === null ? undefined : byLower.get(resolved.toLowerCase());
      if (file) seen.add(file);
    }
  }
  return [...seen];
}

export function typstReferencedImages(project: ProjectContext): string[] {
  return referencedImageFiles(typstFiles(project), project.files).map((file) => file.path);
}

function largeImageFindings(scans: readonly ScannedFile[], project: ProjectContext): Finding[] {
  return referencedImageFiles(scans, project.files)
    .filter((file) => (file.size ?? 0) > LARGE_IMAGE_BYTES)
    .map((file) =>
      make(
        "submission-large-image",
        "submission",
        "warning",
        message("rules.submission-large-image.title", { file: file.path }),
        message("rules.submission-large-image.detail", { limit: LARGE_IMAGE_LABEL }),
        file.path,
      ),
    );
}

function typstInternalNote(scan: TypstScan): boolean {
  return scan.comments.some((comment) => INTERNAL_COMMENT_TERMS.test(scan.text.slice(comment.from, comment.to)));
}

function identifyingValue(scan: TypstScan, from: number, to: number): boolean {
  if (isBlankValue(scan, from, to)) return false;
  const text = scan.text.slice(from, to);
  return /\p{L}/u.test(text) && !/anonymous|omitted|blind review/i.test(text);
}

function namesAuthors(scan: TypstScan): boolean {
  const documents = typstCalls(scan, ["document"]);
  const calls = [...documents, ...typstTemplateCalls(scan)];
  return calls.some((call) =>
    ["author", "authors", "affiliation", "affiliations"].some((name) => {
      const arg = namedArgument(call, name);
      return arg !== undefined && identifyingValue(scan, arg.valueFrom, arg.valueTo);
    }),
  );
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

function blindReviewFindings(scans: readonly ScannedFile[], pdf: PdfFacts | undefined): Finding[] {
  const out: Finding[] = [];
  if (scans.some(({ scan }) => namesAuthors(scan))) {
    out.push(
      make(
        "privacy-blind-author",
        "privacy",
        "error",
        message("rules.privacy-blind-author.title"),
        message("rules.privacy-blind-author.detailTypst"),
      ),
    );
  }
  for (const { path, scan } of scans) {
    const email = EMAIL.exec(scan.masked);
    if (!email) continue;
    out.push({
      ...make(
        "privacy-blind-email",
        "privacy",
        "error",
        message("rules.privacy-blind-email.title", { file: path }),
        message("rules.privacy-blind-email.detail"),
        path,
      ),
      from: email.index,
      to: email.index + email[0].length,
    });
  }
  const acknowledgements = scans.some(
    ({ scan }) =>
      markupLines(scan, /^([ \t]*)=+[ \t]+Acknowledg/i) ||
      /(?<![\p{L}\p{N}_.-])acknowledge?ments?\s*:(?!\s*(?:\(\s*\)|none\b))/iu.test(scan.code),
  );
  if (acknowledgements) {
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
  out.push(...pdfAuthorFindings(pdf));
  return out;
}

function privacyFindings(
  scans: readonly ScannedFile[],
  project: ProjectContext,
  pdf: PdfFacts | undefined,
  anonymousReview: boolean,
): Finding[] {
  const scanned = new Map(scans.map((item) => [item.path, item.scan]));
  const out = project.files.flatMap((file) => {
    const scan = scanned.get(file.path);
    return filePrivacyFindings(file, scan ? () => typstInternalNote(scan) : hasInternalComment);
  });
  if (anonymousReview) out.push(...blindReviewFindings(scans, pdf));
  return out;
}

export function runTypstSubmissionRules({
  project,
  profileId,
  pdf,
  anonymousReview = false,
}: TypstSubmissionRuleInput): Finding[] {
  const profile = submissionProfile(profileId);
  const scans = typstFiles(project);
  return [
    ...(profile.source.portableFileNames ? portableNameFindings(project) : []),
    ...generatedFileFindings(project),
    ...structureFindings(scans, profile),
    ...placeholderFindings(scans),
    ...pdfSubmissionFindings(profile, pdf),
    ...pathFindings(scans, project, profile),
    ...captionFindings(scans),
    ...largeImageFindings(scans, project),
    ...privacyFindings(scans, project, pdf, anonymousReview),
  ];
}

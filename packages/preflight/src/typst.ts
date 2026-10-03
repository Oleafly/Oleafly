import type { SourceRuleInput, SourceRuleSet } from "./engine";
import { runTypstRefsRules, type TypstSourceFile } from "./typst-refs-rules";
import { runTypstSourceRules, typstMetadataFindings } from "./typst-source-rules";
import { runTypstSubmissionRules } from "./typst-submission-rules";
import type { ProjectContext } from "./types";

export { DEFAULT_TYPST_VERSION, runTypstSourceRules, typstMetadataFindings } from "./typst-source-rules";
export { runTypstRefsRules } from "./typst-refs-rules";
export { LARGE_IMAGE_BYTES, runTypstSubmissionRules, typstReferencedImages } from "./typst-submission-rules";

export function typstProjectSources(project: ProjectContext | undefined, fallback: string): TypstSourceFile[] {
  if (!project) return [{ content: fallback }];
  const files = project.files
    .filter((file) => file.content !== undefined && /\.typ$/i.test(file.path))
    .sort((left, right) => Number(right.path === project.mainFile) - Number(left.path === project.mainFile))
    .map((file) => ({ path: file.path, content: file.content ?? "" }));
  return files.length > 0 ? files : [{ path: project.mainFile, content: fallback }];
}

function sourceFindings(input: SourceRuleInput) {
  const sources = typstProjectSources(input.project, input.source);
  const context = input.typstVersion ? { version: input.typstVersion } : {};
  return [
    ...sources.flatMap((file) =>
      runTypstSourceRules(file.content, context).map((finding) => (file.path ? { ...finding, file: file.path } : finding)),
    ),
    ...typstMetadataFindings(
      sources.map((file) => ({ path: file.path ?? "", content: file.content })),
      { anonymousReview: input.anonymousReview },
    ),
  ];
}

export const TYPST_SOURCE_RULES: SourceRuleSet = {
  source: sourceFindings,
  refs: (input, refs) => runTypstRefsRules(typstProjectSources(input.project, input.source), refs),
  submission: (input, project) =>
    runTypstSubmissionRules({
      project,
      profileId: input.submissionProfile,
      anonymousReview: input.anonymousReview,
      ...(input.pdf ? { pdf: input.pdf } : {}),
    }),
};

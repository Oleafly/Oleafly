import { create } from "zustand";
import { CHECK_IDS, detectSubmissionProfile, maskComments, runPreflight } from "@oleafly/preflight";
import type {
  CheckId,
  PreflightEngine,
  PreflightReport,
  ProjectContext,
  RefsContext,
  SubmissionProfileId,
} from "@oleafly/preflight";
import {
  type BibliographyEngine,
  bibliographyDeclarations,
  bibliographyEngineForCommand,
  resolveBibliographyPath,
} from "@oleafly/latex";
import type { DocumentEngineDescriptor, TexFlavor } from "@/lib/tauri";
import { parseEntry } from "@/lib/citation/bibtex";
import { i18n } from "@/i18n";
import { engineErrorMessage, useFilesStore } from "@/store/files";
import { isCompileCheckpointCurrent, useCompileStore } from "@/store/compile";
import { useIndexStore } from "@/store/project-index";

export function preflightEngineFor(
  engine: DocumentEngineDescriptor["id"],
  flavor: TexFlavor | null | undefined,
): PreflightEngine {
  if (engine === "latex") return "bundled";
  if (engine === "latexmk") return flavor ?? "unknown";
  return "unknown";
}

function declaredBibliographies(
  texts: Readonly<Record<string, string>>,
): { raw: string; file: string; engine: BibliographyEngine }[] {
  const declarations: { raw: string; file: string; engine: BibliographyEngine }[] = [];
  for (const [path, content] of Object.entries(texts)) {
    if (!/\.(?:tex|ltx)$/i.test(path)) continue;
    for (const declaration of bibliographyDeclarations(maskComments(content))) {
      declarations.push({
        raw: declaration.raw,
        file: path,
        engine: bibliographyEngineForCommand(declaration.command),
      });
    }
  }
  return declarations;
}

function buildRefsContext(files: ReturnType<typeof useFilesStore.getState>): RefsContext {
  // Labels and bib keys come from the shared project index (the single parser);
  // runRefsRules also re-scans the active source for its own labels, so a just-
  // typed label resolves even before the debounced index catches up.
  const index = useIndexStore.getState().index;
  const definedLabels = index ? index.defs.filter((d) => d.kind === "label").map((d) => d.name) : [];
  const bibKeys = index ? index.defs.filter((d) => d.kind === "bibentry").map((d) => d.name) : [];
  // Duplicate detection needs DOIs, which the index does not store, so parse the
  // loaded .bib files for those.
  const projectTexts = { ...useIndexStore.getState().texts };
  for (const [path, state] of Object.entries(files.files)) projectTexts[path] = state.content;

  // Project files (for missing-asset checks) must include images too, so use the
  // full tree rather than the index (which only indexes .tex/.bib).
  const projectFiles = files.tree.filter((f) => !f.is_dir).map((f) => f.path);
  const knownPaths = [...new Set([...projectFiles, ...Object.keys(files.files)])];
  const declared = declaredBibliographies(projectTexts);
  const unresolvedBibliographies: { file: string; name: string }[] = [];
  const seenUnresolved = new Set<string>();
  for (const declaration of declared) {
    if (
      resolveBibliographyPath(
        declaration.raw,
        declaration.file,
        knownPaths,
        declaration.engine,
      ) !== null
    ) {
      continue;
    }
    const key = `${declaration.file}\n${declaration.raw}`;
    if (seenUnresolved.has(key)) continue;
    seenUnresolved.add(key);
    unresolvedBibliographies.push({ file: declaration.file, name: declaration.raw });
  }
  const bibLoaded = declared.length > 0
    ? unresolvedBibliographies.length === 0
    : bibKeys.length > 0 || knownPaths.some((path) => path.endsWith(".bib"));
  const doiToKeys = new Map<string, string[]>();
  const bibEntries: NonNullable<RefsContext["bibEntries"]> = [];
  for (const [path, content] of Object.entries(projectTexts)) {
    if (!path.endsWith(".bib")) continue;
    for (const chunk of content.split(/(?=@\w+\s*\{)/)) {
      const p = parseEntry(chunk.trim());
      const doi = p?.fields.doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
      if (p) bibEntries.push(p);
      if (p && doi) doiToKeys.set(doi, [...(doiToKeys.get(doi) ?? []), p.key]);
    }
  }
  const duplicateDois = [...doiToKeys.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([doi, keys]) => ({ doi, keys }));

  const allCitedKeys: string[] = [];
  const cite = /\\(?:cite|citep|citet|citeauthor|citeyear|citealt|parencite|textcite|autocite|nocite)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;
  for (const [path, content] of Object.entries(projectTexts)) {
    if (!/\.(?:tex|ltx)$/i.test(path)) continue;
    for (const match of maskComments(content).matchAll(cite)) {
      allCitedKeys.push(...match[1].split(",").map((key) => key.trim()).filter(Boolean));
    }
  }
  const currentBibKeys = [...new Set([...bibKeys, ...bibEntries.map((entry) => entry.key)])];
  const labelFiles = new Map<string, Set<string>>();
  const referencedLabels = new Set(index?.uses.filter((use) => use.kind === "ref").map((use) => use.name) ?? []);
  for (const definition of index?.defs.filter((definition) => definition.kind === "label") ?? []) {
    const filesForLabel = labelFiles.get(definition.name) ?? new Set<string>();
    filesForLabel.add(definition.file);
    labelFiles.set(definition.name, filesForLabel);
  }
  const duplicateLabels = [...labelFiles]
    .filter(([, definingFiles]) => definingFiles.size > 1)
    .map(([label, definingFiles]) => ({ label, files: [...definingFiles] }));
  const unreferencedLabels = (index?.defs ?? [])
    .filter(
      (definition) =>
        definition.kind === "label" &&
        /^(?:fig|figure|tab|table|eq|equation)[:._-]/i.test(definition.name) &&
        !referencedLabels.has(definition.name),
    )
    .map((definition) => ({ label: definition.name, file: definition.file }));
  return {
    bibKeys: currentBibKeys,
    definedLabels,
    bibLoaded,
    projectFiles,
    unresolvedBibliographies,
    duplicateDois,
    bibEntries,
    allCitedKeys,
    duplicateLabels,
    unreferencedLabels,
  };
}

function buildProjectContext(files: ReturnType<typeof useFilesStore.getState>): ProjectContext {
  const texts: Record<string, string> = { ...useIndexStore.getState().texts };
  for (const [path, state] of Object.entries(files.files)) texts[path] = state.content;
  const paths = new Set(files.tree.filter((file) => !file.is_dir).map((file) => file.path));
  for (const path of Object.keys(texts)) paths.add(path);
  return {
    mainFile: files.mainDoc,
    files: [...paths].map((path) => ({ path, ...(texts[path] !== undefined ? { content: texts[path] } : {}) })),
  };
}

// Bumped on every run so a preflight pass that finishes after the project was
// switched can detect it is stale and not paint the old report into the new one.
let preflightSeq = 0;

export type CheckFlags = Record<CheckId, boolean>;
const NO_FLAGS = Object.fromEntries(CHECK_IDS.map((id) => [id, false])) as CheckFlags;

interface PreflightStore {
  report: PreflightReport | null;
  pageText: string[];
  running: boolean;
  showReader: boolean;
  error: string | null;
  ran: CheckFlags;
  // null = use the document-type suggestion.
  enabled: CheckFlags | null;
  // null = use the suggestion.
  open: CheckFlags | null;
  submissionProfile: SubmissionProfileId | null;
  anonymousReview: boolean;
  setRan: (f: CheckFlags) => void;
  setEnabled: (f: CheckFlags) => void;
  setOpen: (f: CheckFlags) => void;
  setSubmissionProfile: (profile: SubmissionProfileId) => void;
  setAnonymousReview: (value: boolean) => void;
  toggleReader: () => void;
  run: () => Promise<void>;
  reset: () => void;
}

export const usePreflightStore = create<PreflightStore>((set) => ({
  report: null,
  pageText: [],
  running: false,
  showReader: false,
  error: null,
  ran: NO_FLAGS,
  enabled: null,
  open: null,
  submissionProfile: null,
  anonymousReview: false,

  setRan: (ran) => set({ ran }),
  setEnabled: (enabled) => set({ enabled }),
  setOpen: (open) => set({ open }),
  setSubmissionProfile: (submissionProfile) => set({ submissionProfile }),
  setAnonymousReview: (anonymousReview) => set({ anonymousReview }),
  toggleReader: () => set((s) => ({ showReader: !s.showReader })),
  reset: () =>
    set({ report: null, pageText: [], running: false, showReader: false, error: null, ran: NO_FLAGS, enabled: null, open: null, submissionProfile: null, anonymousReview: false }),

  run: async () => {
    const seq = ++preflightSeq;
    const pid = useFilesStore.getState().projectId;
    const stale = () => seq !== preflightSeq || useFilesStore.getState().projectId !== pid;
    set({ running: true, error: null });
    try {
      const files = useFilesStore.getState();
      if (!files.engineLoaded) {
        set({
          running: false,
          error: files.engineError
            ? engineErrorMessage(files.engineError)
            : i18n.t(($) => $.core.engine.error.stillLoading),
        });
        return;
      }
      // Lint the document currently in the editor so source offsets line up with
      // the editor for jump-to-source; fall back to the main document.
      const path = files.activePath ?? files.mainDoc;
      const source = files.files[path]?.content ?? files.files[files.mainDoc]?.content ?? "";

      const refs = buildRefsContext(files);
      const project = buildProjectContext(files);
      const state = usePreflightStore.getState();
      const profileSource = files.files[files.mainDoc]?.content ?? project.files.find((file) => file.path === files.mainDoc)?.content ?? source;
      const submissionProfile = state.submissionProfile ?? detectSubmissionProfile(profileSource);
      const compileState = useCompileStore.getState();
      const outputIsCurrent = isCompileCheckpointCurrent(compileState.lastCompileCheckpoint);
      const settledStatus =
        compileState.status === "success" && outputIsCurrent ? "success" : "idle";
      const compileStatus =
        compileState.status === "error" || compileState.status === "unavailable"
          ? compileState.status
          : settledStatus;
      const compile = { status: compileStatus, log: compileStatus === "idle" ? "" : compileState.log } as const;

      const engine = preflightEngineFor(files.engine.id, files.engine.tex_flavor);
      const bytes = outputIsCurrent ? compileState.pdfBytes : null;
      if (bytes) {
        const { extractForPreflight } = await import("@oleafly/preflight/pdf-extract");
        const ex = await extractForPreflight(bytes);
        if (stale()) return; // project switched during PDF extraction
        const report = runPreflight({
          source,
          sourceProfile: files.engine.capabilities.source_preflight_profile,
          pages: ex.pages,
          meta: { lang: ex.lang, title: ex.title, tagged: ex.tagged },
          extraction: ex.extraction,
          readerText: ex.pageText.join("\n"),
          struct: ex.struct,
          refs,
          facts: ex.facts,
          project,
          compile,
          submissionProfile,
          anonymousReview: state.anonymousReview,
          engine,
        });
        set({ report, pageText: ex.pageText, running: false });
      } else {
        const report = runPreflight({
          source,
          sourceProfile: files.engine.capabilities.source_preflight_profile,
          refs,
          project,
          compile,
          submissionProfile,
          anonymousReview: state.anonymousReview,
          engine,
        });
        if (stale()) return;
        set({ report, pageText: [], running: false });
      }
    } catch (e) {
      if (!stale()) set({ running: false, error: String(e) });
      void import("@/lib/log").then(({ logError }) => logError("preflight", e));
    }
  },
}));

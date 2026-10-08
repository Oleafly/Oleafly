import {
  closeCompletion,
  insertCompletionText,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import {
  completionRequestIsCurrent,
  createCompletionRequestGuard,
  typstContextAt,
} from "@oleafly/editor";
import type { ZoteroHit, ZoteroLibraryStatus } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { basename } from "@/lib/path-utils";
import { citationCompletions } from "@/lib/project-intelligence/selectors";
import type {
  BibliographyEntry,
  CitationCompletion,
  ProjectIntelligenceSnapshot,
} from "@/lib/project-intelligence/types";
import { toast } from "@/lib/toast";
import { citeSiteAt, type CiteFormat, type CiteSite } from "@/lib/zotero/cite-syntax";
import { zoteroHint, zoteroHintMessage, zoteroSearchable, type ZoteroHintKind } from "@/lib/zotero/hint";
import { openZoteroSettings } from "@/lib/zotero/open-settings";
import { hitDetail, hitTitle, libraryLabel } from "@/lib/zotero/format";
import { familyNames, prepareCitation, scoreLabel, scorePrepared, type PreparedCitation } from "@/lib/zotero/ranking";
import {
  cachedZoteroSearch,
  searchZoteroLibrary,
  type ZoteroSearchEntry,
} from "@/lib/zotero/search-client";
import { citationText } from "@/features/cite-insert";
import {
  citationKeyForHit,
  ensureZoteroEntries,
  existingKeyForHit,
  projectBibliography,
  type ProjectBibliography,
} from "@/features/zotero-cite";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useZoteroDialogStore } from "@/store/zotero-dialogs";
import { useZoteroLibraryStore } from "@/store/zotero-library";
import { isMathContext } from "./at-suggestions";

const WINDOW = 2_048;
const PROJECT_LIMIT = 100;
const RESULT_LIMIT = 80;
const LEADING_MARKS = new Set(["#", "@", "<", '"']);
const TRAILING_MARKS = new Set([">", '"']);

type Candidate =
  | { readonly kind: "project"; readonly entry: CitationCompletion; readonly score: number }
  | { readonly kind: "zotero"; readonly hit: ZoteroHit; readonly score: number };

interface ProjectCandidate {
  readonly citation: CitationCompletion;
  readonly prepared: PreparedCitation;
}

const preparedEntries = new WeakMap<BibliographyEntry, ProjectCandidate>();

function projectCandidate(entry: BibliographyEntry): ProjectCandidate {
  const cached = preparedEntries.get(entry);
  if (cached) return cached;
  const citation: CitationCompletion = {
    id: entry.id,
    key: entry.key,
    label: entry.key,
    detail: entry.display,
    type: entry.type,
    ...(entry.author ? { author: entry.author } : {}),
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.year ? { year: entry.year } : {}),
    location: { file: entry.file, range: entry.keyRange },
    duplicate: entry.duplicate,
    duplicateIndex: entry.duplicateIndex,
    duplicateCount: entry.duplicateCount,
  };
  const candidate = {
    citation,
    prepared: prepareCitation({ key: entry.key, authors: familyNames(entry.author), title: entry.title ?? "", year: entry.year }),
  };
  preparedEntries.set(entry, candidate);
  return candidate;
}

function projectEntries(snapshot: ProjectIntelligenceSnapshot, query: string): readonly ProjectCandidate[] {
  if (!query.trim()) {
    const first = new Set(citationCompletions(snapshot, "", PROJECT_LIMIT).map((completion) => completion.id));
    return snapshot.bibliography.entries.filter((entry) => first.has(entry.id)).map(projectCandidate);
  }
  return snapshot.bibliography.entries.map(projectCandidate);
}

function retainedSnapshot(): ProjectIntelligenceSnapshot | null {
  const projectId = useFilesStore.getState().projectId;
  const data = useIndexStore.getState().intelligenceState.data;
  return projectId && data?.identity.projectId === projectId ? data : null;
}

function infoPanel(lines: readonly string[]): Completion["info"] {
  return () => {
    const dom = document.createElement("div");
    lines.filter(Boolean).forEach((line, index) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      paragraph.style.margin = "0 0 0.35rem";
      if (index > 0) paragraph.style.opacity = "0.75";
      dom.appendChild(paragraph);
    });
    return dom;
  };
}

function keySourceText(hit: ZoteroHit): string {
  switch (hit.keySource) {
    case "bbt":
      return i18n.t(($) => $.references.zotero.completion.keySource.bbt);
    case "native":
      return i18n.t(($) => $.references.zotero.completion.keySource.native);
    case "extra":
      return i18n.t(($) => $.references.zotero.completion.keySource.extra);
    default:
      return i18n.t(($) => $.references.zotero.completion.keySource.generated);
  }
}

function insertion(view: EditorView, format: CiteFormat, site: CiteSite, key: string): string {
  return citationText(view.state.doc.toString(), format, site, key);
}

function addToBibliography(hit: ZoteroHit, key: string): void {
  const choose = (choices: readonly string[]) => useZoteroDialogStore.getState().chooseBibliography(choices);
  void ensureZoteroEntries([{ hit, key }], { chooseBibliography: choose })
    .then((result) => {
      if (result.error) toast.error(i18n.t(($) => $.references.zotero.completion.addFailed, { key, detail: result.error }));
    })
    .catch((error: unknown) => {
      void logError("add a Zotero citation", error);
      toast.error(i18n.t(($) => $.references.zotero.completion.addFailed, { key, detail: describeError(error) }));
    });
}

function rank(
  query: string,
  project: readonly ProjectCandidate[],
  hits: readonly ZoteroHit[],
  bibliography: ProjectBibliography,
): Candidate[] {
  const blank = query.trim().replace(/^@+/, "") === "";
  const candidates: Candidate[] = [];
  const shown = new Set<string>();
  for (const { citation, prepared } of project) {
    if (shown.has(citation.key)) continue;
    const score = blank ? 0 : scorePrepared(prepared, query);
    if (score === null) continue;
    shown.add(citation.key);
    candidates.push({ kind: "project", entry: citation, score: score + 25 });
  }
  for (const hit of hits) {
    if (shown.has(hit.citationKey) || bibliography.keys.has(hit.citationKey) || existingKeyForHit(hit, bibliography)) continue;
    shown.add(hit.citationKey);
    candidates.push({ kind: "zotero", hit, score: blank ? 0 : hit.score });
  }
  return candidates
    .map((candidate, order) => ({ candidate, order }))
    .sort((left, right) => right.candidate.score - left.candidate.score || left.order - right.order)
    .slice(0, RESULT_LIMIT)
    .map(({ candidate }) => candidate);
}

function guarded(
  guard: ReturnType<typeof createCompletionRequestGuard>,
  run: (view: EditorView, from: number, to: number) => void,
): NonNullable<Completion["apply"]> {
  return (view, _completion, from, to) => {
    if (!completionRequestIsCurrent(guard, view.state)) {
      closeCompletion(view);
      return;
    }
    run(view, from, to);
  };
}

function identity(option: Completion): string {
  const label = String(option.label);
  let from = 0;
  while (from < label.length && LEADING_MARKS.has(label[from])) from += 1;
  let to = label.length;
  while (to > from && TRAILING_MARKS.has(label[to - 1])) to -= 1;
  return label.slice(from, to);
}

function shifted(option: Completion, offset: number): Completion {
  if (offset === 0) return option;
  const apply = option.apply;
  return {
    ...option,
    apply: (view, completion, from, to) => {
      if (typeof apply === "function") {
        apply(view, completion, from + offset, to);
        return;
      }
      view.dispatch(insertCompletionText(view.state, typeof apply === "string" ? apply : String(option.label), from + offset, to));
    },
  };
}

function build(
  context: CompletionContext,
  guard: ReturnType<typeof createCompletionRequestGuard>,
  format: CiteFormat,
  site: CiteSite,
  entry: ZoteroSearchEntry | null,
  base: CompletionResult | null,
  status: ZoteroLibraryStatus | null,
  hint: ZoteroHintKind | null,
): CompletionResult | null {
  const snapshot = retainedSnapshot();
  const project = snapshot ? projectEntries(snapshot, site.query) : [];
  const bibliography = projectBibliography();
  const ranked = rank(site.query, project, entry?.hits ?? [], bibliography);
  const options: Completion[] = ranked.map((candidate) => {
    if (candidate.kind === "project") {
      const { entry: citation } = candidate;
      return {
        label: citation.key,
        displayLabel: citation.key,
        type: "constant",
        detail: `${citation.detail} · ${basename(citation.location.file)}`,
        info: infoPanel([citation.title ?? "", [citation.author, citation.year].filter(Boolean).join(" · ")]),
        apply: guarded(guard, (view, from, to) => {
          view.dispatch(insertCompletionText(view.state, insertion(view, format, site, citation.key), from, to));
        }),
      };
    }
    const { hit } = candidate;
    return {
      label: hit.citationKey,
      displayLabel: hit.citationKey,
      type: "constant",
      detail: hitDetail(hit, status),
      info: infoPanel([hitTitle(hit), [hit.authors.join(", "), hit.year].filter(Boolean).join(" · "), `${libraryLabel(hit, status)} · ${keySourceText(hit)}`]),
      apply: guarded(guard, (view, from, to) => {
        const key = citationKeyForHit(hit);
        view.dispatch(insertCompletionText(view.state, insertion(view, format, site, key), from, to));
        addToBibliography(hit, key);
      }),
    };
  });
  if (options.length === 0 && site.query.includes(" ")) return base;
  const citationKeys = new Set(options.map((option) => String(option.label)));
  for (const key of bibliography.keys) citationKeys.add(key);
  for (const option of base?.options ?? []) {
    const label = identity(option);
    if (citationKeys.has(label) || scoreLabel(label, site.query) === null) continue;
    options.push(shifted(option, (base?.from ?? site.from) - site.from));
  }
  if (hint) {
    const text = zoteroHintMessage(hint, status);
    const action = i18n.t(($) => $.references.zotero.hint.action);
    options.push({
      label: text,
      displayLabel: text,
      type: "text",
      detail: action,
      info: infoPanel([text, action]),
      apply: (view) => {
        closeCompletion(view);
        openZoteroSettings();
      },
    });
  }
  if (options.length === 0) return null;
  return { from: site.from, to: context.pos, options, filter: false };
}

function isSettled<T>(value: T | Promise<T>): value is T {
  return !(value instanceof Promise);
}

export function zoteroCitationSource(format: CiteFormat, base: CompletionSource): CompletionSource {
  return (context) => {
    const start = Math.max(0, context.pos - WINDOW);
    const before = context.state.sliceDoc(start, context.pos);
    const local = citeSiteAt(before, before.length, format);
    if (!local) return base(context);
    if (format === "latex" && local.kind === "prose") {
      const around = context.state.sliceDoc(start, Math.min(context.state.doc.length, context.pos + WINDOW));
      if (isMathContext(around, context.pos - start)) return base(context);
    }
    if (format === "typst") {
      const where = typstContextAt(context.state, context.pos);
      if (where === "comment" || where === "raw") return base(context);
    }
    const site: CiteSite = { ...local, from: local.from + start, to: context.pos };
    const guard = createCompletionRequestGuard(context);
    const status = useZoteroLibraryStore.getState().status;
    const hint = zoteroHint(status);
    const baseValue = format === "latex" ? null : base(context);
    const searchable = zoteroSearchable(status) && status !== null;
    const cached = searchable && status ? cachedZoteroSearch(site.query, status.generation) : null;
    if ((!searchable || cached) && isSettled(baseValue)) {
      return build(context, guard, format, site, cached, baseValue, status, hint);
    }
    return (async () => {
      let entry: ZoteroSearchEntry | null = cached;
      if (!entry && searchable && status) {
        const controller = new AbortController();
        context.addEventListener("abort", () => controller.abort());
        try {
          entry = await searchZoteroLibrary(site.query, { generation: status.generation, signal: controller.signal });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return null;
          void logError("search the Zotero library", error);
          entry = null;
        }
      }
      const resolvedBase = await baseValue;
      if (context.aborted) return null;
      return build(context, guard, format, site, entry, resolvedBase, status, hint);
    })();
  };
}

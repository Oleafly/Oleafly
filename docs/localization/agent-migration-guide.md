# Desktop String Migration Guide (for autonomous agents)

This document is the single source of truth for migrating the Oleafly desktop
app's remaining user-visible strings into the i18next catalogs. It is written
so an agent with no prior context can execute the work end to end. Follow it
exactly; where it conflicts with your instincts, the document wins.

Branch: `feat/localization-platform-phase-0`. Do all work on this branch (or
stacked branches based on it), never on `main` directly.

## 1. What is already done — do not redo it

- **Runtime**: `i18next@26.3.6` + `react-i18next@17.0.11` (exact pins) with a
  single desktop-owned instance in `src/i18n/index.ts`. It initializes before
  `registerContributions()` and before React mounts, for all three windows
  (main, `?view=update`, `?view=preview`) via `bootstrap()` in `src/main.tsx`.
- **Locales**: `en`, `es`, `fr`, `zh` in `src/i18n/locale.ts`
  (`SUPPORTED_LOCALES`), with native display names, BCP-47 primary-subtag
  normalization, and OS-locale resolution through `@tauri-apps/plugin-os`.
- **Namespaces**: `common`, `settings`, `errors` under
  `src/i18n/locales/<locale>/<namespace>.json`, wired in
  `src/i18n/resources.ts`. The `ns` and `supportedLngs` init options are
  derived automatically — you never edit them by hand.
- **Typed strict selectors**: `src/i18n/types.d.ts` augments i18next from the
  English resources. Unknown keys are TypeScript errors.
- **Settings language row**: `src/components/layout/SettingsModal.tsx` is the
  reference implementation of a migrated component. Read it before migrating
  anything.
- **Preference plumbing**: `uiLocalePreference` (`"system" | locale`) persisted
  as `oleafly.locale` in `src/store/settings.ts`; `changeLocale()` applies
  changes live; reset-to-defaults re-applies the locale.
- **Inventory tooling**: `scripts/localization-inventory.mjs` generates
  `docs/localization/string-inventory.tsv` (+ summary JSON). CI runs
  `pnpm localization:self-test && pnpm localization:check` and fails if the
  tracked artifacts do not match the source.

## 2. The goal

Migrate every remaining occurrence classified `translate` in
`docs/localization/string-inventory.tsv` (3,485 rows at the time of writing)
into the catalogs, with **complete `en`, `es`, `fr`, and `zh` values for every
key you add**. Work surface by surface (vertical slices), one commit per slice.

Slice order (surface = column 6 of the TSV; row counts at time of writing):

| Order | Surfaces | translate rows |
| --- | --- | --- |
| 1 | `shell`, `core` | 1,213 |
| 2 | `settings` | 388 |
| 3 | `editor`, `wysiwyg` | 667 |
| 4 | `preview`, `preflight` | 449 |
| 5 | `ai` | 229 |
| 6 | `research-tools`, `templates`, `diagram` | 360 |
| 7 | `onboarding` (tours) and the rest | ~180 |

Do NOT migrate in this pass (leave the strings alone):

- Rows classified `structured-code-then-translate` (mostly Rust/Tauri error
  strings) — these need the error-code contract from
  `docs/localization/error-code-manifest.json` first, which is a separate
  design task.
- Rows classified `user-content`, `third-party/raw-diagnostic`,
  `developer-only`, `channel-specific`.
- Rail-tab labels, command labels/groups/hints/keywords registered in
  `src/contributions/` — the registry currently freezes strings at startup;
  making registry copy resolve at render time is a separate architectural task
  (plan Phase 2). Skip any string whose only consumer is the contribution
  registry, and list the files you skipped in your final report.

## 3. Per-slice workflow (repeat for every slice)

1. **List the work**: extract the slice's rows from the inventory. Example for
   the settings surface:

   ```sh
   awk -F'\t' 'NR>1 && $9=="translate" && $6=="settings" {print $3":"$4"\t"$14}' \
     docs/localization/string-inventory.tsv | sort -u
   ```

   Column 3 = file, 4 = line, 14 = the string value.

2. **Design keys before editing**. Group related strings under one namespace
   file per feature area. Create new namespaces as needed (e.g. `workspace`,
   `editor`, `preview`, `ai`, `tours`, `templates`, `diagram`, `preflight`).
   A new namespace means: create
   `src/i18n/locales/{en,es,fr,zh}/<namespace>.json` and register all four in
   `src/i18n/resources.ts` (follow the existing import pattern). Nothing else;
   `ns` derives automatically.

3. **Replace literals with selector calls** in the component:

   ```tsx
   import { useTranslation } from "react-i18next";

   const { t } = useTranslation(["common", "editor"]);
   // ...
   <span>{t($ => $.editor.toolbar.insertFigure)}</span>
   ```

   Critical, non-obvious rule: **the selector `$` only exposes the namespaces
   passed to `useTranslation([...])`**, and the first selector segment is
   always the namespace name. `useTranslation()` alone exposes only
   `$.common.*`. Passing a namespace you did not list is a TypeScript error.

4. **Translate every key into es/fr/zh yourself** — native-quality, complete
   sentences, matching the register already used in the existing catalogs
   (informal-professional developer-product tone; zh uses full-width
   punctuation). Never leave an empty string or English placeholder in a
   non-English catalog: all four files for a namespace must have identical key
   structure. TypeScript only validates against `en`, so run the parity check
   in step 6.

5. **Regenerate the inventory** (mandatory before every commit — CI fails
   otherwise, because the artifacts are content-hashed against the source):

   ```sh
   pnpm localization:inventory
   ```

   Commit the regenerated `docs/localization/*` files together with your code.

6. **Verify** (all must pass; the pre-commit hook runs most of this anyway):

   ```sh
   pnpm lint
   pnpm build          # tsc validates every selector against the en catalog
   pnpm test
   pnpm localization:check
   node -e '
     const fs = require("fs");
     const locales = ["en","es","fr","zh"];
     const dir = "src/i18n/locales";
     const keys = o => Object.entries(o).flatMap(([k,v]) =>
       typeof v === "object" ? keys(v).map(s => k+"."+s) : [k]);
     for (const ns of fs.readdirSync(dir+"/en")) {
       const ref = JSON.stringify(keys(JSON.parse(fs.readFileSync(dir+"/en/"+ns))).sort());
       for (const l of locales) {
         const got = JSON.stringify(keys(JSON.parse(fs.readFileSync(dir+"/"+l+"/"+ns))).sort());
         if (got !== ref) { console.error("KEY MISMATCH", l, ns); process.exit(1); }
       }
     }
     console.log("catalog key parity OK");
   '
   ```

7. **Manually smoke-test the slice**: `pnpm tauri dev`, open Settings →
   General → Language, switch to Español, then 中文, and confirm the slice's
   UI updates live and nothing renders a raw key path or empty string. Switch
   back to English.

8. **Commit** with a message like
   `feat: localize the settings surface (388 strings)`.
   Plain conventional style, no Co-Authored-By lines, no emoji.

## 4. Message-writing rules (violations will be rejected in review)

- **Semantic keys, never English text as the key.**
  `settings.language.description`, not `t("Choose the interface language…")`.
- **Never concatenate translated fragments.** One key = one complete
  grammatical unit. If a sentence has dynamic parts, use interpolation:
  `"deleted": "Deleted {{name}}"` and `t($ => $.common.deleted, { name })`.
- **Plurals**: CLDR v4 suffixes with a numeric `count` value —
  `"files_one": "{{count}} file"`, `"files_other": "{{count}} files"`.
  Note: `es`/`fr` need `_one`/`_other` (fr also `_many` for large numbers),
  `zh` needs only `_other`.
- **Rich text with React elements**: use `<Trans>` with named components
  (`components={{ docsLink: <a … /> }}`), never numeric placeholders, never
  `dangerouslySetInnerHTML`. Keep a `useTranslation()` hook in the same
  component so it re-renders on language change.
- **Migrate accessibility copy too**: `aria-label`, `title`, `placeholder`,
  tooltip and visually-hidden text are in scope; the inventory lists them.
- **Do not localize**: `data-testid`, IDs, enum values, CSS classes, file
  paths, engine names, keyboard shortcut characters, protocol strings sent to
  AI models, compiler output, or anything the user authored.
- **Do-not-translate glossary** (keep verbatim inside translated sentences):
  Oleafly, LaTeX, Typst, Markdown, Pandoc, Tectonic, TeX, Git, GitHub, BibTeX,
  SyncTeX, TikZ, DOI, arXiv, Ollama, MCP, Vim, PDF, URL.
- **Dates/numbers**: if you touch a formatter, use `Intl.*` with the active
  locale; never hand-build locale-specific formats.
- Tests that assert exact English copy: prefer switching the assertion to a
  stable `data-testid`/role. If a test must assert copy, assert through the
  English catalog import, not a duplicated string literal.

## 5. Hard constraints

- Never call `i18n.init()` a second time; language changes go through
  `changeLocale()` from `src/i18n/index.ts`.
- Never import the i18n instance into `packages/*` workspace packages. If a
  package component needs a string, pass the translated text (or a narrow
  translator function) in through its existing props/kit contract from the
  host app, and note it in your report. When in doubt, defer the package and
  report it.
- Never store a translated string in a Zustand store, a saved file, or any
  persisted state. Store codes/IDs; translate at render.
- Never change `uiLocalePreference` semantics ("system" must stay stored as
  `"system"`).
- Changing the UI language must never touch spellcheck/proofing settings or
  document content.
- Keep diffs mechanical: a migration commit should not refactor component
  logic, rename variables, or reformat untouched code.

## 6. Definition of done

- `awk -F'\t' 'NR>1 && $9=="translate"' docs/localization/string-inventory.tsv`
  returns only rows you have consciously deferred (registry/contributions,
  workspace packages, structured-error strings), each listed in your final
  report with a one-line reason.
- All four catalogs have identical key structure; parity check passes.
- `pnpm lint && pnpm build && pnpm test && pnpm localization:check` all pass.
- A manual pass in `pnpm tauri dev` in Español and 中文 shows no raw keys,
  no clipped empty labels, and live switching everywhere you migrated.
- Your final report lists: strings migrated per slice, new namespaces added,
  deferred rows with reasons, and any place where you were unsure of a
  translation (flag these for native review — do not silently guess
  domain-specific terminology).

## 7. Quick reference — adding one string, end to end

English literal in `src/components/library/EmptyShelf.tsx`:
`<p>No projects yet</p>`

1. `src/i18n/locales/en/workspace.json` → `{ "library": { "empty": "No projects yet" } }`
2. Same structure in `es` (`"Aún no hay proyectos"`), `fr`
   (`"Aucun projet pour l'instant"`), `zh` (`"还没有项目"`).
3. If `workspace` is a new namespace: add the four imports + entries in
   `src/i18n/resources.ts`.
4. In the component:
   `const { t } = useTranslation(["workspace"]);` …
   `<p>{t($ => $.workspace.library.empty)}</p>`
5. `pnpm localization:inventory && pnpm build && pnpm test && pnpm localization:check`
6. Commit code + regenerated docs together.

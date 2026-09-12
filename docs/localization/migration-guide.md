# Adding and changing interface text

This guide covers every user-visible string in the desktop app: JSX text, attributes such as `aria-label`, `title`, `placeholder` and `alt`, toasts, dialog copy, empty states, registry labels, tour text and package messages. Read [design.md](design.md) first for the architecture.

## The one rule

User-visible text never appears as a literal in a component, store, feature module or package. It lives in a catalog under `src/i18n/locales/en/` and is read through a translator. Biome flags JSX text, user-visible attributes (`placeholder`, `aria-label`, `title`, `label`, `tooltip`) and toast literals; the type checker rejects unknown keys. `alt` text is not linted because decorative images carry an empty value, so review it by hand.

## Reading a string

Inside a React component:

```tsx
import { useTranslation } from "react-i18next";

const { t } = useTranslation(["common", "settings"]);

<Button>{t(($) => $.common.actions.save)}</Button>
<Input placeholder={t(($) => $.settings.search.placeholder)} />
```

`useTranslation` lists the namespaces the component uses. The selector `$` exposes only those namespaces, and the first segment is always the namespace name. The hook subscribes the component to language changes, so it re-renders when the user switches language.

Outside React (stores, feature modules, registries):

```ts
import { i18n } from "@/i18n";

toast.success(i18n.t(($) => $.core.compile.finished));
```

The instance is initialized before any store or registry runs, so it is safe at module scope inside a function or thunk, never as a top-level constant evaluated at import time.

## Choosing a namespace and key

Namespaces follow product areas. Put a string in the namespace of the surface that renders it:

| Namespace | Surface |
|---|---|
| `common` | shared verbs and states reused verbatim (`Save`, `Cancel`, `Loading…`) |
| `shell` | window chrome, rail, command palette, omnibar, splash |
| `settings` | every settings section |
| `workspace` | editor workspace layout, panels, source control |
| `library` | home, project library, templates, new project |
| `editor` | editor toolbar, symbols, checkpoints, source tools |
| `preview` | PDF preview and the preview window |
| `preflight` | preflight findings and panel |
| `ai` | assistant, chat, personas, agents |
| `references` | references and citations panel |
| `researchTools` | research workspace and tools |
| `templates`, `diagram`, `onboarding`, `catalog`, `usage`, `core`, `errors` | as named |

Keys are semantic, camelCase and describe the element, never the English text:

```json
{
  "compile": {
    "start": "Compile",
    "finished": "Compiled in {{seconds}} s",
    "errors_one": "{{count}} error",
    "errors_other": "{{count}} errors"
  }
}
```

A message goes in `common` only when the same wording is deliberately shared. Do not put a string in `common` because its English happens to match another one.

## Interpolation, plurals and rich text

- Named values: `"Deleted {{name}}"` with `t(($) => $.library.deleted, { name })`.
- Plurals: CLDR suffixes with a numeric `count`. Author `errors_one` and `errors_other` in English and call the base key: `t(($) => $.editor.errors, { count })`. The type layer strips the suffixes and i18next picks the right form for the active locale.
- Rich text with React elements uses `<Trans>` with named components:

```tsx
<Trans
  ns="settings"
  i18nKey={($) => $.settings.engine.installHint}
  components={{ guideLink: <a href={GUIDE_URL} /> }}
/>
```

with `"installHint": "Read the <guideLink>installation guide</guideLink>."`. Under strict selectors the key is a fully qualified selector and there is no `t` prop. Keep `useTranslation` in the same component so it re-renders on a switch, and avoid reserved element names such as `link` or `img` as component names.

Never concatenate fragments, never add an English plural `s` in code, and never build a sentence from separately translated words.

## What stays verbatim

Do not move these into catalogs: `data-testid`, ids, enum values, CSS classes, file paths, engine names, keyboard shortcut characters, protocol strings sent to AI models, tool descriptions, compiler and Git output, and anything the user authored. Glyph-only JSX text such as `·`, `/` or `…` is allowed by the lint rule.

## Objects that carry labels

Registries, option tables and tour definitions that used to hold English strings at module scope now hold thunks:

```ts
registerRailTab({
  id: "files",
  label: () => i18n.t(($) => $.shell.rail.files),
  ...
});
```

Consumers resolve the thunk at render through the helpers in `@oleafly/registry` (`railTabLabel`, `commandLabel`, `commandGroup`, `commandHint`, `commandKeywords`) and call `useTranslation()` so they re-render on a switch. Command keywords keep their English aliases appended so English search terms work in every language.

## Packages

Packages under `packages/` never import the app's i18n instance. A package that renders text receives a translator through the kit or host object it already accepts and declares its message keys in a `messages.ts` file; a package that produces data (findings, diagnostics) returns `{ key, params }` and the host translates at render. A test in the package asserts that every declared key exists in the English catalog.

## Dates, numbers and lists

Use `src/lib/intl.ts` (`formatDate`, `formatDateTime`, `formatNumber`, `formatCompactNumber`, `formatRelativeTime`, `formatList`). Never call `Intl` constructors with `undefined` or bare `toLocaleString()` for presentation; the WebView's own locale does not follow the app setting. Case folding for comparisons stays pinned to `en-US`.

## Errors from the backend

Backend errors that a user should read arrive as stable codes. Render them with `describeError` from `src/lib/app-error.ts`, which maps the code to the `errors` namespace and keeps any raw diagnostic verbatim. `notifyError` already does this. Do not display `String(error)` or `error.message` directly.

## Tests

Prefer roles and test ids. When a test must assert copy, import the English catalog and read the value:

```ts
import enSettings from "@/i18n/locales/en/settings.json";
expect(screen.getByText(enSettings.language.label)).toBeInTheDocument();
```

The test setup initializes English and throws on any missing key, so a typo in a selector fails the suite. A registry test resolves labels through the helpers with a stub context.

## Context for translators

When a key is ambiguous on its own (single words, `Open`, `Expand`, `Draft`), add a short description at the same key path in `src/i18n/context/<namespace>.json`:

```json
{ "actions": { "expand": "Expands a collapsed tree node, not AI text expansion" } }
```

## Checklist before you push

```bash
pnpm exec biome lint <the files you touched>
pnpm i18n:types
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec vitest run <the directories you touched>
pnpm i18n:validate
```

`pnpm i18n:validate` reports keys that other locales are missing; that is expected for a pull request that adds English keys and is resolved before release.

# Desktop localization design

Status: approved 2026-09-11, implemented for 0.4.1. Tracks [#153](https://github.com/Oleafly/Oleafly/issues/153).

This is the reference for how the desktop app is localized. Read it before adding or changing user-visible text.

## Goals

- Every user-visible string in the desktop app comes from a catalog. Hardcoded English in JSX, attributes, toasts, dialogs, registries, tours, packages and the native menu fails the build.
- Switching the interface language takes effect live in every window, without a reload.
- Startup never flashes English before the chosen language renders.
- Adding a locale is additive: new catalog files, one registry entry, no code changes.
- Every shipped locale passes the same mechanical checks before release.
- The document a user writes, its spellcheck language and the language the AI answers in are untouched by the interface language.

## Runtime

The frontend uses `i18next` with `react-i18next`, pinned to exact versions. One private instance lives in `src/i18n/index.ts` and is created with `createInstance()`; nothing imports a global.

- Strict typed selectors: `t($ => $.settings.general.language.label)`. The first selector segment is always the namespace. Types are generated from the English catalogs by `pnpm i18n:types`, so an unknown key is a TypeScript error.
- Missing keys throw under Vitest, warn once per key in development, and render the key in production while logging it.
- Interpolation uses named values (`{{name}}`), plurals use CLDR suffixes with a numeric `count`, and rich text uses `<Trans>` with named components. Fragments are never concatenated.

## Locales

Supported tags are declared once, in `packages/i18n-contract`. The first release ships `en` and `zh-Hans`. Chinese uses the script subtag so `zh-Hant` can be added later without renaming keys.

Resolution order is the persisted preference, then the operating system locale from `tauri-plugin-os`, then `en`. The WebView's `navigator.language` is never consulted because it does not reflect the OS setting on macOS or Linux.

The resolver matches BCP-47 tags by longest prefix and carries an alias table for Chinese: `zh`, `zh-CN`, `zh-SG` and `zh-Hans-*` resolve to `zh-Hans`; `zh-TW`, `zh-HK`, `zh-MO` and `zh-Hant-*` resolve to `zh-Hant` when it exists and otherwise fall back to `zh-Hans`.

`<html lang>` and `dir` are set before first paint from the cached preference and again on every switch. CJK font stacks are pinned with `:lang()` selectors.

## Catalogs

Catalogs are plain JSON at `src/i18n/locales/<tag>/<namespace>.json`. Translator context lives beside them in `src/i18n/context/<namespace>.json`; the app never reads it. A glossary at `src/i18n/glossary.json` lists terms that must never be translated and preferred renderings per locale.

Namespaces follow product areas: `common`, `shell`, `core`, `settings`, `workspace`, `library`, `editor`, `preview`, `preflight`, `ai`, `intelligence`, `references`, `researchTools`, `templates`, `diagram`, `onboarding`, `catalog`, `symbols`, `errors`, plus `native` for strings the operating system renders and one namespace per UI package.

Keys are semantic (`settings.general.language.label`), never English text. A message belongs in `common` only when the same concept and wording are deliberately shared.

Style rules are enforced by the validator: no em dashes, no leading or trailing whitespace, glossary terms verbatim, and only the plural suffixes the locale's CLDR rules allow (`zh-Hans` has `_other` only).

## Loading

English is bundled eagerly because it is the fallback for every missing key. Every other locale is one lazy chunk, produced by a `manualChunks` rule that groups `src/i18n/locales/<tag>/*` into `locale-<tag>`. The active locale is loaded before React mounts. On a switch it is loaded, registered with `addResourceBundle`, and then `changeLanguage` runs. There are no Suspense boundaries and no backend plugin.

One locale is roughly 50 KB gzipped against an entry chunk near 1 MB, so per-namespace splitting is not worth its cost in compression.

## Startup and windows

`index.html` reads the cached preference from `localStorage` in the same pre-paint script that applies the theme, sets `lang` and `dir`, and picks the splash text from a small inline table. `bootstrap()` in `src/main.tsx` awaits locale initialization before `registerContributions()` for every view (`main`, `update`, `preview`, `browser`). The splash stays up during that await, so there is no English flash.

Secondary windows read the cached preference at boot, confirm it over IPC, and subscribe to `i18n:locale-changed` for live switches. Window titles are reset on every switch. The CodeMirror inline-AI widget, which mounts its own React root, receives the instance through `I18nextProvider`.

## Preference ownership

The Rust config file owns the preference as `ui_locale`, either `system` or a tag. Rust needs it before any WebView exists to build the native menu and to show pre-WebView dialogs.

- `initial_state` carries the resolved locale to the frontend, which caches it in `localStorage` under `oleafly.locale` for the pre-paint path.
- `set_ui_locale(tag)` persists the preference, relabels the menu on the main thread, and emits `i18n:locale-changed` to every WebView.
- Reset-to-defaults restores `system` through the same command.

## Registries resolve at render

Command, rail-tab, tour and settings-navigation registries store message thunks instead of strings. The command palette, omnibar, rail and tour guide resolve them at render, and re-render on a language change because they subscribe through `useTranslation`. Command search matches the active locale's keywords and always includes the English keywords as aliases.

## Workspace packages

Packages must not import the app's i18n instance. `packages/i18n-contract` provides the locale registry, the `Translator` port type, the glossary and the catalog validation helpers, and depends on nothing from the app or from i18next.

- Packages that render UI (`diagram`, `templates`, `preview`, `editor`, `wysiwyg`) receive a translator through the kit or host object they already accept. Each exports its message-key union, and a test asserts every key exists in the English catalog.
- Packages that produce data (`preflight`, compile-log parsers, proofreading) emit `{ key, params }` in findings. The host translates at render. Consumers that feed the AI use a fixed English translator so protocol text stays English.

Biome lints `packages/` as well as `src/`.

## Native layer

Tauri does not localize any predefined menu item, not even Copy or Paste, so every label is supplied by the app.

- Strings the operating system renders live in the `native` namespace. Rust embeds the catalog files with `include_str!` and a unit test asserts key parity across locales. No i18n crate is added.
- The app and Edit submenus carry ids so they can be found, predefined items use the `_with_text` builders, and a locale change rebuilds the menu and swaps it with `AppHandle::set_menu` inside `run_on_main_thread`.
- Native dialogs take title, message and custom button text from the same catalog. Where the verb is generic the default button variants are used so the OS supplies localized buttons.

### Errors

Commands that report failures a user is expected to read and act on return a structured envelope:

```json
{ "code": "project.name_empty", "params": {}, "detail": null }
```

`code` is a stable identifier from a closed set. `detail` carries third-party output byte for byte and is never translated. The frontend maps known codes to the `errors` namespace and renders unknown codes as a localized heading over the verbatim detail. Compiler, Git, language-server and network output always stays verbatim under a localized framing. Migration proceeds module by module.

## Formatting

`src/lib/intl.ts` wraps `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat` and `Intl.ListFormat` with the active app locale. Presentation code calls these helpers; comparisons that need case folding stay pinned to `en-US`. A lint rule flags zero-argument `Intl` constructors and bare `toLocaleString()`.

## Enforcement

| Gate | Catches | Runs in |
|---|---|---|
| Biome `style/noJsxLiterals` with an allow list of glyphs | JSX text children | `pnpm lint`, pre-commit, CI |
| Biome plugin `.biome/i18n-attributes.grit` | literal `placeholder`, `aria-label`, `title`, `label` and `tooltip` attributes | same |
| Biome plugin `.biome/i18n-toast-literals.grit` | literal toast and `notifyError` messages | same |
| `pnpm i18n:types:check` plus `tsc` | stale generated types, unknown keys, wrong namespace, missing interpolation values | pre-commit, `pnpm build`, CI |
| `pnpm i18n:validate` (`scripts/i18n/validate.ts`) | missing or extra keys in a shipped locale, empty values, placeholder and tag parity, plural suffixes, style rules, glossary terms | pre-commit, CI |
| Vitest missing-key handler | components that render an unknown key | `pnpm test` |
| Rust parity test | missing native strings in any locale | `cargo test` |
| `check:performance` | locale chunks leaking into the entry chunk | CI |

## Translations

English is the source catalog. Other locales are maintained from it by the Oleafly team and checked mechanically before they ship:

- `pnpm i18n:validate` fails on any key missing from a shipped locale, any extra key, any empty value, any placeholder or tag that differs from the English source, any plural suffix the locale's CLDR rules do not allow, and any style violation for the locale (for Simplified Chinese: half-width punctuation between Chinese characters, corner brackets, em dashes, stray whitespace).
- Glossary terms in `src/i18n/glossary.json` must stay verbatim in every locale.
- Translator context for ambiguous keys lives in `src/i18n/context/<namespace>.json` at the same key path as the catalog.

Contributors add or change English keys only. A pull request that adds English keys is complete once the other locales pass validation.

## Testing

- Packaged end-to-end runs seed `oleafly.locale` to `en` so text-based locators keep working. One smoke spec boots in `zh-Hans` and asserts through test ids.
- Vitest initializes the instance with English synchronously and throws on missing keys.
- Catalog contract tests cover parity, placeholders, plural suffixes and empty values.
- There are no per-locale snapshots.

## Not translated

AI system prompts and instructions, tool descriptions and schemas, skill bodies and the skills catalog, model and provider identifiers, protocol strings, compiler and Git and language-server output, user documents, template starter content, deadline venue data, storage keys, keyboard shortcuts and test ids.

## Distribution

The Windows installer lists English and Simplified Chinese and shows the language selector. macOS ships a localized display name through `InfoPlist.strings`.

## Adding a string

1. Add the key to the English namespace file and, when the meaning is not obvious from the key, a short description to the matching context file.
2. Use it through `t($ => $.namespace.path)` or `<Trans>`; in a package, through the injected translator.
3. Run `pnpm i18n:types`, then `pnpm i18n:validate`.
4. Commit the source and the catalogs together. See [migration-guide.md](migration-guide.md) for the full rules.

## Adding a locale

1. Add the tag, native name and direction to `packages/i18n-contract`.
2. Add glossary entries for the locale in `src/i18n/glossary.json` and, if the locale needs its own style checks, extend the validator.
3. Provide the catalog files under `src/i18n/locales/<tag>/` and make `pnpm i18n:validate` pass.
4. Add the installer language entries.

# Design system

The desktop app gets its controls from a small kit in `src/components/ui/`
and a few settings and sidebar primitives. If the kit already has the thing a
screen needs, the screen uses the kit. Copying a kit element's classes by hand
is how the app ended up with side panel headers in three sizes and status
pills in several shades of green, so guard tests now fail on the copies we
have seen most often.

## Which primitive to use

Every clickable action is a `Button` from `ui/button.tsx`. Pick a `variant`
(`default`, `secondary`, `outline`, `ghost`, `ghostPrimary`, `destructive`,
`link`) and a `size` (`default`, `xs`, `sm`, `lg`, `icon`). The button sizes
the icons inside it, so those icons need no size class.

Status pills and counts are a `Badge` from `ui/badge.tsx`. The variant sets
the tone: `success`, `warning`, `destructive` and `info` for state, `muted`
for neutral labels and counts, `primaryGhost` for an accent label such as
"Recommended". The older neutral styles (`outline`, `quiet`, `secondary`,
`default`) are still there. `size="sm"` is the compact 10px pill for dense
rows, and a badge with an icon in it also needs `gap-1`. If a component keeps
a map from its own states to a tone, map to `BadgeVariant` names, not colour
classes.

Anything that spins while work is running is a `Spinner` from
`ui/spinner.tsx`. It takes `size` (`xs`, `sm`, `md`, `lg`, `xl`), stops
spinning under reduced motion, and stays hidden from screen readers unless you
give it an `aria-label`. Inside a `Button`, the button picks the size.

For a panel with nothing to show, `ui/empty.tsx` has three states.
`EmptyState` centres an icon, a title, a description and any actions.
`LoadingState` is a spinner and a label inside an `output`, so screen readers
announce it. `ErrorState` is an alert with a message and room for a retry
button. All three take `size="compact"` for sidebars and cards. The same file
has `EmptyIntro`, the eyebrow, heading and body that the research tools show
before the first search, and the older `Empty`, `EmptyMedia`, `EmptyTitle` and
`EmptyDescription` pieces for large empty pages.

A settings card with a label, an optional description and a control on the
right is a `SettingsRow` from `settings/SettingsRow.tsx`. It also takes
`adornment` for a badge beside the label, `details` for extra lines under the
description and `icon` for a leading icon. `SettingsToggleRow` is a
`SettingsRow` where the whole card is the switch. Notes go in `SettingsNote`
and file paths in `SettingsPath`.

Connected services in Settings, Integrations use `IntegrationCard` from
`settings/IntegrationCard.tsx`. The default layout matches GitHub, Zotero and
alphaXiv. With `framed` it becomes the bordered card the citation sources use,
with a brand icon, a status badge and a docs link. The parts those cards
repeat live in the same file: `ConnectedBadge`, `IntegrationConnected`,
`IntegrationError`, `IntegrationBusyButton` and `IntegrationKeyField`.

Every rail panel starts with `SidebarPanelHeader` from
`layout/SidebarSection.tsx`, and collapsible sections inside a panel use
`SidebarSection`. Text that has to look like a sidebar title takes the
exported `SIDEBAR_TITLE_CLASS`.

The small uppercase heading above a group of settings or tool fields is a
`SectionHeading` from `ui/section-heading.tsx`. If the heading needs a ref or
an element type the component does not offer, put `SECTION_HEADING_CLASS` on
your own element.

Hand-built menus and overflow lists use `MenuRow` from `ui/menu-row.tsx` for
an icon and a label. Radix menus have their own items in
`ui/dropdown-menu.tsx`.

Tab strips are a `TabsList` from `ui/tabs.tsx`. Pass `scrollable` when the
triggers can grow wider than the strip, so it scrolls instead of clipping, and
`fill` when the triggers should split the full width.

Hover help is a `Tooltip` from `ui/tooltip.tsx`, never the native `title`
attribute. It renders into the body and stays inside the window.

Modal content goes in a `Dialog` from `ui/dialog.tsx`. A yes or no question
is a `ConfirmationDialog` from `ui/confirmation-dialog.tsx`. A dialog that
needs its own layout uses `ModalShell` from `ui/modal-shell.tsx`, which brings
the backdrop, the panel, and the same focus and Escape handling as the kit
dialogs. Its `layer` prop picks one of three stacking levels: `dialog` for
most dialogs, `raised` for one that opens over Settings, and `nested` for a
dialog opened from inside another.

## Shared hooks and helpers

Behaviour that several screens need lives in one place too. `useCopyStatus`
in `ui/use-copy-status.ts` copies text and shows "Copied" for a moment.
`useDismiss` in `ui/use-dismiss.ts` closes a popover or menu on an outside
click or Escape. Tauri events go through `useTauriEvent` and
`useTauriSubscription` in `src/hooks/use-tauri-event.ts`, or through
`withEventListener` in `lib/tauri.ts` when a listener only lives for one
command. `useAsyncTask`, `useDebouncedValue` and `useDocSearch` sit in the
same folder.

For plain functions, `lib/path-utils.ts` has `basename` and `dirname` for both
slash styles, `lib/base64.ts` encodes bytes and text, `lib/format-bytes.ts`
formats sizes in base 1024 with localized units, and `formatRelativeTimeFrom`
in `lib/intl.ts` writes times such as "5 minutes ago". `lib/image-mime.ts`
knows which images LaTeX can include, `lib/local-storage.ts` reads and writes
JSON without throwing, and `lib/download-blob.ts` saves a blob as a file.
Check these before writing a helper of your own.

## No outlines

No element in any app gets a CSS `outline`, a focus ring (`ring-*`,
`focus-visible:ring-*`, `outline-*`) or a box shadow drawn as a ring. Focus
and selection show as a background tint such as `focus-visible:bg-accent` or a
border colour change such as `focus-visible:border-ring`. The last rule in
`src/styles/globals.css` turns outlines off everywhere. Keep it, and do not
work around it.

## Guard tests

The guards read the source files and fail when a known copy shows up.

`src/styles/no-outline-utilities.test.ts` fails on any ring or outline
utility in `src/` or `packages/`.

`src/styles/design-system.test.ts` fails on three things: a `Loader2` or
`LoaderCircle` with `animate-spin` outside `Spinner`, the settings row class
cluster outside `SettingsRow`, and a hand-written pill (a borderless
`rounded-full` with small text and a tint) outside the kit. A pill that no
`Badge` variant can express goes in that file's allowlist, with the reason
next to it.

`src/components/layout/SidebarSection.test.tsx` checks that every panel
registered in `src/contributions/tabs.tsx` renders `SidebarPanelHeader`, and
that no file other than `SidebarSection.tsx` writes its own sidebar title
style.

When a guard fails, switch the code to the primitive it names. If the
primitive can't do what the screen needs, extend the primitive and its test.
Copying its classes is the thing the guard exists to stop.

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
rows, and a badge with an icon in it also needs `gap-1`. `size="count"` is
the small number bubble pinned to the top right corner of an icon button (the
button needs `relative`). With `asChild` the badge styles its child instead of
a `span`, so a clickable or removable tag is a `<Badge asChild><button>` and a
count that screen readers announce is a `<Badge asChild size="count"><output>`.
If a component keeps a map from its own states to a tone, map to
`BadgeVariant` names, not colour classes.

Labels that need their own colour, not a state tone, take a `Tone` from
`ui/tones.ts`. Item kinds and tags use it today. Each tone has `icon`, `text`,
`tint`, `hover` and `dot` classes with the light and dark shades built in.
`KIND_TONES` maps note and file kinds onto them. `nameTone(name)` hashes a
name into one of the coloured tones, so the same name always gets the same
colour. Notes goes through `tagTone`, which ignores case and a leading `#`.

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

A faint background behind a page comes from one of three patterns, each an
absolutely placed SVG that ignores the pointer, so its parent needs
`relative`. `GridPattern` and `DotPattern` are the project library's grid and
dots. `RingsPattern` draws circles that spread from the top centre and fade
out. Notes puts it behind the empty panel and an empty Notes Home.

A settings card with a label, an optional description and a control on the
right is a `SettingsRow` from `settings/SettingsRow.tsx`. It also takes
`adornment` for a badge beside the label, `details` for extra lines under the
description and `icon` for a leading icon. `SettingsToggleRow` is a
`SettingsRow` where the whole card is the switch, and it takes the same
`details`. Notes go in `SettingsNote` and file paths in `SettingsPath`.

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

A search palette that opens over the window (the command palette, the
omnibar, the note switcher) is a `CommandDialogShell` from
`ui/command-dialog.tsx`. It brings the overlay, the panel, the field and the
list. `leading` and `trailing` sit beside the field, `placement` and
`className` move and size the panel, and `footer` goes under the list. Its
rows take `COMMAND_ITEM` and its groups `COMMAND_GROUP`.

Hand-built menus and overflow lists use `MenuRow` from `ui/menu-row.tsx` for
an icon and a label. Radix menus have their own items in
`ui/dropdown-menu.tsx`.

A formatting toolbar that has to fit its width renders its controls through
`ToolbarOverflow` from `ui/toolbar-overflow.tsx`. Each `ToolbarControl` has a
`render` for the bar and a `renderMenu` for the one "More" menu that collects
whatever does not fit. Menu forms are `ToolbarMenuItem` (an action, or a
check item when it has `checked`, greyed out with `disabled`), `ToolbarSubMenu`, `ToolbarDropdown` (a
popover on the bar and a submenu in the menu) and `toolbarPicker`, which hosts
a popover picker such as the table or symbol picker as a menu row. A dropdown
button on the bar itself is a `ToolbarMenuButton`.

Tab strips are a `TabsList` from `ui/tabs.tsx`. Pass `scrollable` when the
triggers can grow wider than the strip, so it scrolls instead of clipping, and
`fill` when the triggers should split the full width.

A suggestion list that opens under or over a text field, such as the `@` and
`/` menus in the assistant composer, is a `Listbox` of `ListboxOption`s from
`ui/listbox.tsx`, with a `ListboxHeading` above each group. The options never
take focus. The field keeps it and points at the highlighted option. The host
places the list with `className`.

A row in a tree, such as an outline heading or a file, is a `TreeRow`
from `ui/tree-row.tsx`. It indents by `depth` and has a label button, a
chevron toggle with `aria-expanded` when `expanded` is set, and an optional
`trailing` slot for a count or badge. The whole row tints on hover, and the
active row gets an accent border on its left edge over a quiet tint, in the
sidebar colours. Hover help on long rows goes in `tooltip`, shown by
`useDelegatedTooltips` on the list.

A list of sections down the side of a window, like the one in Settings or in
the server admin console, is made of `NavItem`s from `ui/nav-item.tsx`. The
current item gets `aria-current="page"` and a border. The others tint on hover
and on keyboard focus.

A row that shows where the current page sits, like the bar over an open note,
is a `Breadcrumb` from `ui/breadcrumb.tsx`. Give it an `aria-label`, put a
`BreadcrumbList` of `BreadcrumbItem`s inside, and put a `BreadcrumbSeparator`
between each pair. A place you can go back to is a `BreadcrumbLink`. When the
crumb runs an action or opens a menu, pass `asChild` and a `button`. The last
place is a `BreadcrumbPage`: it gets `aria-current="page"` and the foreground
colour, and it ends in an ellipsis when it runs out of room. The places before
it stay muted until hovered or focused. The separator is a chevron that screen
readers skip. The note header and the editor's section bar use it, and so does
the path above the References panel.

A row of figures, like the storage summary in Settings or the numbers on the
admin console overview, is a `StatGrid` from `ui/stat-grid.tsx`. Each figure
has a label, a value and, if it needs one, a short detail line.

Tables are built from `ui/table.tsx`. A column the reader can sort by gets a
`SortableTableHead` (`label`, `sortLabel` for the button, `direction`,
`onSort`, `numeric`), which sets `aria-sort` and draws the arrow. `nextSort`
gives the next `SortState` after a click: the first direction for a new
column, then the other one, and with `clearable` no sort after both. A
windowed body pads the rows it skips with `TableSpacerRow`.

A month grid is a `Calendar` from `ui/calendar.tsx`, and a date field that
opens one is a `DatePicker` from `ui/date-picker.tsx`. Pass `components` to
replace one part of the grid, such as the day button, the week number or the
caption. The kit keeps its own chevrons. The bar with the month arrows lets
clicks through everywhere but the arrows, so a caption can be a button. It
lines up with the caption whatever padding you give the grid.

A caption that lets people jump to any month is a `MonthPicker` from
`ui/month-picker.tsx`. Its trigger reads like "November 2026" with a small
chevron, and opens a `Popover` with the year between two arrows and the twelve
short month names in a grid of three. Give it `month` and `onMonthChange`;
inside a `Calendar` caption, pass `goToMonth` from `useDayPicker`. The current
month is filled with the primary colour. The month on show is shaded and takes
focus when the popover opens, through the `onOpenAutoFocus` prop of `Popover`.
Choosing a month closes the popover. Children go
under the grid as extra actions, usually `PopoverItem`s, which close it too.

A search box that takes qualifiers such as `engine:typst` is a `QuerySearch`
from `ui/query-search.tsx`. Give it a schema from `@oleafly/search-query` and
the analysed query; it brings the highlighting, the suggestion dropdown, the
keyboard handling and the warnings. Highlighted words inside a text field,
like the skill and mention chips in the assistant composer, take the classes
in `ui/inline-token.ts`.

`QuerySearch` takes `trailing` for controls at the right end of the box, such
as the search mode button or a `Kbd` hint. They sit after the clear button and
the text field narrows to make room, so several fit. The mode button is `SearchModeMenu` from
`ui/search-mode-menu.tsx`: Best match, Exact text, Regular expression or
Fuzzy, with its labels in `common.searchModes`. The caller keeps the mode, and
`store/search-modes.ts` remembers one per search scope.

Matched parts of a result are marked with `Highlighted` from
`ui/highlighted.tsx`, given the text and `[start, end]` ranges in UTF-16 units,
which is what the Rust searches return. `highlightParts` in the same file
gives the pieces without the markup.

A plain filter box at the top of a panel, with a search icon and a clear
button, is a `SearchField` from `ui/search-field.tsx`. Clearing it puts focus
back in the field. Pass `clearOnEscape` to let Escape empty it as well. Once
it's empty, Escape goes on to the panel as usual. The browser's own clear
button is hidden, so the field never shows two.

A floating "find in this view" panel is a `FindBar` from `ui/find-bar.tsx`.
It brings the field, a match count that screen readers announce, the
previous, next and close buttons, Enter and Shift+Enter, Escape, and the IME
guard. The host passes its search adapter as `onStep`, plus optional
`toggles` (match case and so on) and an optional `replace` row. The terminal
and the PDF preview use it.

Code, config, commands and any other text a reader may want to copy go in a
`CodeBlock` from `ui/code-block.tsx`. It brings the copy button, which sits in
the top right corner of the block and shows when the pointer is over the
block or keyboard focus is inside it, and stays visible on touch screens.
`code` is the text that gets copied, children (when given) are what the block
shows, such as highlighted tokens, and `preClassName` adjusts the block's
size and colors. A block that isn't a `<pre>`, like a rendered diagram, wraps
its content in `CopyableBlock` from `ui/copyable-block.tsx`. Logs, error output and
plain text previews stay as a plain `<pre>`.

A rendered block, such as a diagram, chart, embed or table, sits in a
`BlockFrame` from `ui/block-frame.tsx`: a small uppercase `label` in the top
left, `actions` in the top right, the body, and a `message` that replaces the
body when there is nothing to draw or drawing failed. `framed={false}` drops
the border and padding, which is how `CopyableBlock` uses it. Code that builds
the DOM itself, like an editor node view, uses the same classes through
`BLOCK_FRAME`, `BLOCK_SURFACE`, `BLOCK_LABEL`, `BLOCK_ACTIONS`,
`BLOCK_MESSAGE`, `BLOCK_CARD` and `BLOCK_REVEAL` (shown while the block is
hovered or focused). A copy button built that way takes `COPY_BUTTON_CLASS`
and `COPIED_FEEDBACK_MS` from `ui/copyable-block.tsx`.

Highlighted code is coloured by one map in `globals.css`: any element with
the `code-tokens` class colours the `tok-*` spans inside it from the
`--cm-*` variables. `HighlightedCode` in `ui/code-highlighter.tsx` adds that
class itself. An editor that decorates text instead of rendering React calls
`tokenSpans(language, text)` from the same file after
`loadHighlightLanguage(language)`, and puts `code-tokens` on the block.

Colours with a meaning have tokens: `--diff-insert`, `--diff-delete` and
their `-strong` forms for changed lines and changed words, and `--chart-1` to
`--chart-8` for chart series. Both switch with the dark theme.

An image from another site waits behind a `RemoteImageNotice` from
`ui/remote-image-notice.tsx` until the reader asks for it. Whether it may
load comes from one store in `lib/remote-image.ts`: `remoteImage(src)` says
whether a source is remote, `remoteImageAllowed(url)` checks the images
loaded this session and the hosts trusted in Settings, `allowRemoteImage`
and `trustRemoteImageHost` change it, and `subscribeRemoteImages` tells a
view to look again. Chat replies and notes both use it.

Markdown outside an editor goes through `renderMarkdownDocument` in
`ui/markdown-renderer.tsx`, which brings GitHub tables, math and a render
cache. A screen with its own look passes options: `components` (replaces the
chat components, so spread `markdownComponents` to keep some of them),
`rehypePlugins` (run before KaTeX), `urlTransform`, and a cache `namespace`
of its own.

A colour the user can pick is a `ColorSwatch` from `ui/color-swatch.tsx`:
a round toggle with `pressed`, a check mark when chosen, and its `name` in a
`Tooltip` (`label` overrides the screen reader name, `size` is `sm`, `md` or
`lg`). A colour shown next to a label, like a project's colour in a menu, is
a `ColorDot` from the same file. A project's colour comes from
`useProjectColorOf` in `store/project-colors.ts`, which applies the colour
picked in the library, then the project's own, then the default.

Hover help is a `Tooltip` from `ui/tooltip.tsx`, never the native `title`
attribute. It renders into the body and stays inside the window.

Modal content goes in a `Dialog` from `ui/dialog.tsx`. A yes or no question
is a `ConfirmationDialog` from `ui/confirmation-dialog.tsx`. A dialog that
needs its own layout uses `ModalShell` from `ui/modal-shell.tsx`, which brings
the backdrop, the panel, and the same focus and Escape handling as the kit
dialogs. Its `layer` prop picks one of three stacking levels: `dialog` for
most dialogs, `raised` for one that opens over Settings, and `nested` for a
dialog opened from inside another. Set `animateWidth` when the panel changes
width while it is open. Settings uses it to widen for the Notes preview. The
panel opens at its final width. A change after that eases over 200ms, or
happens at once when the system asks for reduced motion.

## Shared hooks and helpers

Behaviour that several screens need lives in one place too. `useCopyStatus`
in `ui/use-copy-status.ts` copies text and shows "Copied" for a moment.
`useDismiss` in `ui/use-dismiss.ts` closes a popover or menu on an outside
click or Escape. Tauri events go through `useTauriEvent` and
`useTauriSubscription` in `src/hooks/use-tauri-event.ts`, or through
`withEventListener` in `lib/tauri.ts` when a listener only lives for one
command. `useAsyncTask`, `useDebouncedValue` and `useDocSearch` sit in the
same folder. `useMediaQuery` in `lib/media-query.ts` follows a CSS media
query, and `useReducedMotion` in `lib/reduced-motion.ts` follows the system's
reduced motion setting.

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

`src/styles/design-system.test.ts` fails on four things: a `Loader2` or
`LoaderCircle` with `animate-spin` outside `Spinner`, the settings row class
cluster outside `SettingsRow`, a hand-written pill (a borderless
`rounded-full` with small text and a tint) outside the kit, and a `<pre>` in
a file that doesn't use `CodeBlock`. A pill that no `Badge` variant can
express, or a `<pre>` that shows logs or plain text rather than code, goes in
that file's allowlist, with the reason next to it.

`src/components/layout/SidebarSection.test.tsx` checks that every panel
registered in `src/contributions/tabs.tsx` renders `SidebarPanelHeader`, and
that no file other than `SidebarSection.tsx` writes its own sidebar title
style.

When a guard fails, switch the code to the primitive it names. If the
primitive can't do what the screen needs, extend the primitive and its test.
Copying its classes is the thing the guard exists to stop.

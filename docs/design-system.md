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
for neutral labels and counts (its text is `foreground/60`, which keeps 4.5:1
on the grey fill even at 10px), `primaryGhost` for an accent label such as
"Recommended", `comment` for a label in the comment colours (the "New"
badge on a comment that just arrived). The older neutral styles (`outline`, `quiet`, `secondary`,
`default`) are still there. `size="sm"` is the compact 10px pill for dense
rows, and a badge with an icon in it also needs `gap-1`. `size="count"` is
the small number bubble pinned to the top right corner of an icon button (the
button needs `relative`). With `asChild` the badge styles its child instead of
a `span`, so a clickable or removable tag is a `<Badge asChild><button>` and a
count that screen readers announce is a `<Badge asChild size="count"><output>`.
If a component keeps a map from its own states to a tone, map to
`BadgeVariant` names, not colour classes.

A pill you press is a `Chip` from `ui/chip.tsx`, such as a preset in the
inline AI box or a saved instruction. It tints on hover and focus, which a
`Badge` doesn't. Pass `pressed` to make it a toggle. It sets `aria-pressed`
and turns the primary tint on, and a check mark inside shows the state without
colour. A chip that just runs something leaves `pressed` out.

A small set of controls floating over content, such as the zoom controls on an
image or the app zoom level, is a `FloatingBar` from `ui/floating-bar.tsx`: a
rounded pill with the toolbar role, made of frosted glass (`GLASS_PANEL` from
`lib/utils`) so the content underneath shows through, blurred, in both themes. The caller places it and gives it an
`aria-label`; its buttons are `rounded-full` `TooltipIconButton`s.

A small window that floats over the desktop, like quick capture, is painted
with `WINDOW_GLASS` from `lib/utils`. The window itself does the blur: it is
created transparent and given the system's frosted material by `frost_window`
on macOS and Windows. `WINDOW_GLASS` only tints it.
On Linux, where there is no blur, the app surface stays solid.

Zoom controls are a `ZoomBar` from `ui/zoom-bar.tsx`: a `FloatingBar` with a
minus button, the level as a percentage, a plus button and a reset. `value` is
the level as a fraction, kept between `min` and `max`. The bar calls
`onStep(-1)`, `onStep(1)` and `onReset`. The reset shows `resetLabel` as text,
or uses it as the tooltip when you pass `resetIcon`. Button labels come in
through `labels`, because the bar has no strings of its own. `size="sm"` makes
the level text smaller, as in the image viewer; the app zoom bar uses the
default.

A panel that slides in over a preview from its left or right edge, such as
the PDF outline or the annotation list, is a `FloatingSidePanel` from
`ui/floating-side-panel.tsx`. It brings the frosted card, the header with an
icon, a title and a close button, and a body that scrolls. Give it `open`,
`side`, `title`, `closeLabel` and `onClose`. `icon` sits before the title and
`headerActions` sit before the close button. `ariaLabel` names the panel when
the title alone is not enough. `width` is a CSS length and defaults to
`19rem`, and the panel never grows wider than its container. A closed panel
slides off towards its own edge and turns `inert`, so focus and clicks skip
it. Its parent needs `relative`. `bodyClassName` changes the body padding.
`footer` holds actions that stay below the body while the body scrolls. To
show an item in the body, scroll the `[data-side-panel-body]` element
yourself. Don't call `scrollIntoView`: it also scrolls the clipped parent,
and that drags a closed panel back into view.

A file or folder icon is a `FileIcon` or `FolderIcon` from
`files/fileIcon.tsx`, and a type badge (`TEX`, `PDF`) is a `FileBadge` from the
same file. Related kinds share a colour token (`--color-file-source`,
`--color-file-prose`, `--color-file-pdf` and so on in `globals.css`, each mapped
to one of the `--chart-*` colours and used as `text-file-*`), and the icon's
body takes a light tint of it. Unknown files are grey. Add a new extension to
the kind it belongs to rather than giving it a colour of its own. Pass the
file's path as `name` where you have it: a slide deck is an `index.tsx` under
`slides/`, and only its path says so. The project tree shows badges instead of
icons when the `fileMarkers` setting asks for them.

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

An error line under a form or an action is an `InlineAlert` from
`ui/inline-alert.tsx`: red text on a red tint that screen readers announce as
an alert. Pass `icon` (a Lucide icon) to show one before the message,
`bordered` for the framed version dialogs use, and `size="sm"` when it sits
next to larger text. Don't write those classes by hand.

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

An Appearance tab that styles text, such as Notes or Visual mode, is built
from `settings/AppearanceControls.tsx`. `AppearanceTabLayout` puts the options
beside a sticky `AppearancePreviewFrame` and stacks them on narrow windows.
`SettingsGroup` is a titled block of rows. `TypefaceCards`, `FontRow`,
`FontSizeRow`, `LineHeightRow`, `ChoiceRow`, `WidthCards`, `ToggleRow` and
`ColorChoiceRow` read and write one setting by its key through
`useAppearanceSetting`, and each shows a `ResetSetting` button once the value
differs from its default. A font size list with a "follow another setting"
choice passes `automatic` to `FontSizeControl`.

A tab strip inside a Settings section remembers its tab through
`useSettingsTab` from `settings/use-settings-tab.ts`. Open Settings without a
destination and it comes back on the session's last section and tab. A link
that names a section opens that section on its default tab, or on the tab the
link asks for.

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
`ui/dropdown-menu.tsx`. `DropdownMenuItemText` puts a small grey line under an
item's label, for what the action applies to or why it is greyed out. A menu
that opens from the right edge of the window takes `submenuSide="left"`, so its
submenus open to the left and their chevrons sit on the left and point that way.

Removed and added text use the diff colours, `bg-diff-delete` and
`bg-diff-insert`, with `-strong` for the change that's selected or hovered.
The git diff view, Notes suggestions and the PDF Annotations panel share them,
so a change looks the same everywhere.

A section that folds open is a `CollapsibleSection` from `ui/collapsible-section.tsx`.
By default it's a bordered card with the chevron at the far end, as in Settings.
`variant="group"` drops the card for a small grey heading with the chevron in
front. Use it for groups inside a list, like the Annotations panel's Drafts and
Resolved.

A formatting toolbar that has to fit its width renders its controls through
`ToolbarOverflow` from `ui/toolbar-overflow.tsx`. Each `ToolbarControl` has a
`render` for the bar and a `renderMenu` for the one "More" menu that collects
whatever does not fit. Menu forms are `ToolbarMenuItem` (an action, or a
check item when it has `checked`, tinted `bg-primary/10` while it is on, greyed out with `disabled`), `ToolbarSubMenu` (tinted the same way with `active`), `ToolbarDropdown` (a
popover on the bar and a submenu in the menu) and `toolbarPicker`, which hosts
a popover picker such as the table or symbol picker as a menu row. A dropdown
button on the bar itself is a `ToolbarMenuButton`. `moreBadge` puts a mark on
the More button for the controls folded into it; the sidebar uses it for a dot
when a hidden view has something pending. A toolbar is one row and
doesn't wrap; the Markdown toolbar, below, is the one exception. List the
controls most important first, as whole groups
with their leading divider (`groupControl` in `EditorToolbar.tsx` joins single
controls into one): whatever doesn't fit moves into More from the right, and
the More button stays at the end of the row. A group can give a `collapsed`
form (its width and render) and says how many tools it holds (`tools`). The
fit folds whichever groups it must to keep the most tools on the bar, so a
folded group can sit before groups that still show; the Notes and Markdown
toolbars fold H1 to H6 into one Text style menu this way. The fit is the pure
`fitToolbar(items, width)` (`fitSteps` lists every state from all shown to
none), so a bar's behaviour at a given width can be tested without a DOM.
A bar with no width yet folds everything into More; pass `showAllUntilMeasured`
to show every control until the first measurement instead. The project
sidebar's view icons use it, so opening a project never flashes a lone More
button, and their More menu lists the views that don't fit in the order the
person arranged them.

The rich-text pieces both of those toolbars share live in
`components/editor/rich-text-controls.tsx`: `TextColorMenu` (LaTeX colour
names, so a paper still exports them), the alignment items, clear formatting,
`ToolbarPopover` with `FieldForm` for a link or address field, and
`EmojiPopover`. `TextColorMenu` takes an `onColor(spec | null)` callback, not
an editor, so the same menu works on any surface.

A Markdown file has one toolbar in Code, Visual and Both. `markdownRow` in
`components/editor/markdown-toolbar-controls.tsx` builds the row once and
runs it against a `MarkdownTarget` from `markdown-model.ts`.
`visualTarget(editor)` runs the Tiptap commands. `sourceTarget(getView)` runs
those same commands on the Markdown text. It takes the blocks around the
selection plus one on each side, adds the reference definitions they use,
parses them with Visual's parser, applies the command in a hidden editor and
writes them back with Visual's serializer. Only the characters that changed
are replaced, as small separate edits, so comments and other people's carets
stay where they were. A caret is placed only inside the block that holds it,
trying its own line first; if there's no exact spot there, the action does
nothing instead of guessing. Code therefore writes what Visual saves, leaves
the selection where Visual would, and each action is one undo step. The first
key you type after an action goes through the same model when that changes the
result, so Bold at a bare caret followed by typing gives bold text, as it does
in Visual. That key changes only the text next to what you typed: anything else
Visual would rewrite in the block is kept as you wrote it, and if Visual can't
spell the result, the key types plain and the bold waits for the next one.
Nothing in the engine can throw into the editor: an error is reported and the
toolbar falls back to its resting state.

The same slice gives Code its button tints (`modelState`). They update at once
when the caret moves, and after a short pause while you type or in a block
that is slow to read. In a Markdown file Code has Visual's shortcuts: ⌘B, ⌘I,
⌘U, ⌘E, ⌘⇧S, ⌘. and ⌘⇧, for marks, ⌘⌥0 to ⌘⌥6 for paragraph and headings,
⌘⇧7, ⌘⇧8 and ⌘⇧B for lists and quotes (⌘⇧B bolds in a list item, where a
quote can't go, as Visual does), and ⌘⌥C for a code block. An editor key you
set in Settings wins over them. The right-click menu and the command palette
run the same actions; in Visual the palette acts on Visual's own selection. Visual also reads Pandoc's own
`[x]{.underline}`, `[x]{.mark}`, `^x^` and `~x~`, so older files toggle off as
expected. In Both, the right pane is a read-only preview, so the toolbar edits
the code. On a read-only file the formatting buttons are disabled; in a live
shared project only Visual is read-only, so Code and Both keep them. When the
bar has less than about 22 rem beside the mode switch, the formatting group
moves to its own row, and that row starts without a divider.

An emoji picker is the `EmojiGrid` from `ui/emoji-grid.tsx`,
which takes its labels and locale as props; `EmojiChooser` fills them in from
the app.

Tab strips are a `TabsList` from `ui/tabs.tsx`. Pass `scrollable` when the
triggers can grow wider than the strip, so it scrolls instead of clipping, and
`fill` when the triggers should split the full width.

The editor's file tabs, the skill chips above the assistant composer and any
other strip that scrolls sideways with its scrollbar hidden but isn't a
`TabsList` use `hooks/use-sideways-scroll.ts`. `useSidewaysScroll` makes a
mouse wheel scroll the strip sideways and scrolls the active item into view
when it changes or is added. `useScrollEdges`, which `useSidewaysScroll` also
runs, marks the strip with `data-overflow-start` or `data-overflow-end` while
items are hidden past an edge. Put `SIDEWAYS_FADE` on the strip to fade those
edges out instead of cutting the last label off. A strip that fits gets no
fade.

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

The strip of short marks on the right edge of a document, one per heading,
is an `OutlineRail` from `ui/outline-rail.tsx`. The code editor and Notes both
use it. The host passes the headings with their `level`, a `row` function that
gives each one its label and what a click does, and the index of the heading
being read. That heading's mark turns the primary colour. Hovering the marks
opens the list beside them. The rail hides itself with fewer than two marks,
and the host sets `hidden` when the text leaves no room for it.

`RadioGroupCard` in `ui/radio-group.tsx` is a radio option shown as a picture
with a label under it. Use it inside `RadioGroup` when people choose by
looking, like a theme or a layout. The selected card gets a border in the
primary color and a check next to its label. Arrow keys move between cards,
the same as any `RadioGroup`.

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

A menu or small form that opens from a button is a `Popover` from
`ui/popover.tsx`. The button is part of it and the popover keeps its own open
state. `PopoverItem` is a row that runs an action and closes the popover.

A card that belongs to something on screen that is not a button, such as a
text selection in a PDF, is an `AnchoredPopover` from the same file. The
caller owns `open` and `onOpenChange`, and there is no trigger. `anchor` is a
function that returns a `DOMRect`, or any object with `getBoundingClientRect`,
such as a `Range`. The popover reads it again whenever it repositions, so the
card follows the selection while the page scrolls or zooms. Pass the element
that scrolls with the anchor, or any element inside it, as `contextElement`.
Without it the popover only follows scrolling of the window. `side`, `align`
and `sideOffset` place the card, and `hideWhenDetached` hides it while the
anchor is scrolled out of view. `ariaLabel` names the dialog. `bare` drops
the card's border, background and padding but keeps its shadow, for content
that brings its own box, such as a `CommentComposer`.

A `Popover` that floats over busy content can take `glass` for the frosted
surface the library's Advanced filters and the editor's Outline use. It blurs
what's behind it and adds a soft sheen. It also sets `data-glass`, so the dark
theme's solid dialog background leaves it alone. Put solid cards inside it
when rows need to stand out from the blur.

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

Text fields are an `Input` from `ui/input.tsx`. When a field has to keep its
text exactly as typed (an ID, a path, a URL, a command, code), spread
`LITERAL_INPUT` on it: that turns off autocorrect, automatic capitals and
spelling marks. Search and filter fields spread `SEARCH_INPUT`, which turns off
autofill as well. An `Input` with `type="search"` picks up `SEARCH_INPUT` by
itself, and one with `type="url"` or `type="email"` picks up `LITERAL_INPUT`,
so the spread is only needed on plain text fields. `SearchField`,
`QuerySearch`, `FindBar`, `CommandDialogShell` and the emoji search have it
already. A placeholder too long for its field ends in an ellipsis
(`placeholder-shown:text-ellipsis`) rather than stopping mid-word. German
labels run long, so this comes up.

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
size and colors. Code blocks share one surface: the `--code-block-bg` token
(`bg-code-block`), a soft grey in light mode and the muted tone in dark mode,
with the `xl` radius. The editor's `pre`, chat replies and published notes use
the same surface. A block that isn't a `<pre>`, like a rendered diagram, wraps
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

Every swatch has an edge from `SWATCH_EDGE`, including the `ColorPicker` in a
theme field. It is a border in 30% foreground, drawn outside the colour, so a
swatch that matches the card behind it still shows up in light and dark mode.

A short list of named items, like the projects a dialog asks about, is a
`DetailList` from `ui/detail-list.tsx`. Each item gets a `key`, a `title` and
one line of `detail` under it. Past about four rows the list scrolls, which
keeps a `ConfirmationDialog` from growing taller than the window.

A notice strip above the editor is a `WorkspaceBanner` from
`ui/workspace-banner.tsx`, in the `primary` or `warning` tone. Its buttons
are `WorkspaceBannerButton`s in the same tone. When a button's action fails,
a `WorkspaceBannerAlert` under the row says why.

Hover help is a `Tooltip` from `ui/tooltip.tsx`, never the native `title`
attribute. It renders into the body and stays inside the window.

Modal content goes in a `Dialog` from `ui/dialog.tsx`. A yes or no question
is a `ConfirmationDialog` from `ui/confirmation-dialog.tsx`. A dialog that
needs its own layout uses `ModalShell` from `ui/modal-shell.tsx`, which brings
the backdrop, the panel, and the same focus and Escape handling as the kit
dialogs. Its `layer` prop picks one of three stacking levels: `dialog` for
most dialogs, `raised` for one that opens over Settings, and `nested` for a
dialog opened from inside another.

Every modal has the same surface. `DialogContent`, `ModalShell` and the New
Project dialog carry `data-modal-surface`, which is `#181818` in the dark
theme. Popovers and menus keep `--popover` (`#121212`). A new modal that
draws its own panel adds the attribute. Don't tint the panel underneath it.

A `Dialog` is on the same modal stack as `ModalShell`. A dialog opened from
Settings, or from another dialog, gets Escape, Tab and outside clicks to
itself, and the one underneath stays open until its turn comes. When a
`Dialog` closes, focus goes back to the control that opened it. Settings is the
same size on every section and tab. A section that needs more room arranges
itself by its own width with a container query. The Notes appearance preview
does this: it sits beside the options when there is room and above them when
there isn't.

Comment threads and project chat, on the desktop and in the web client, come
from `ui/comments/`. `CommentThread` draws a whole thread from a plain
`CommentThreadModel`: the quote, author rows with a relative time and the exact
time in a Tooltip, replies that fold behind a count once there are two or
more, a Reply link that opens a composer with an @mention of the person being
answered, a ⋯ menu on hover (Edit, Copy link, Resolve thread, then Delete in
red), and resolved threads folded to one line until opened. `CommentItem` is
one message on its own. Its action line
holds the reaction pills (`ReactionBar` from `comment-reactions.tsx`: border
pills with `aria-pressed`, your own in `bg-primary/10`, a Tooltip naming who
reacted, and a smile-plus button that opens the quick six with an optional
full-picker slot) followed by Reply. `useReactions` holds the optimistic
reaction state, so `ReactionPills`, `ReactionAdd` and `ReactionError` can sit
in different places and still share it. Chat rows are
`CommentItem variant="bubble"`: the body sits in a white `rounded-2xl` bubble
with the `sidebar-border` border, at most 80% wide. Other people's messages
sit on the left with the avatar beside the bubble and the name and time above
it. Your own sit on the right with only the time. The React button and the ⋯
menu sit beside the bubble on its inner side and fade in on hover or focus.
That side column always keeps the same width, and the "New" badge sits over it
until you hover, so a bubble never rewraps when its state changes. The reaction
pills and "Waiting to send" go under the bubble. `chatGroups(messages)` marks
which messages continue a group: the same verified author, neither deleted,
and less than five minutes after the group's first message. A follow-up gets
`continued`, which drops the avatar and name and sets it 4px under the one
before instead of 12px. Its time moves to a Tooltip on the bubble, and screen
readers still hear it. Bodies are a Markdown subset (`**bold**`,
`_italic_` or `*italic*`, `~~strike~~`, inline code, `-` and `1.` lists, @mentions, plain
http links, always underlined so they don't depend on colour) parsed by `comment-markdown.ts` and drawn by `CommentBody` as React
elements, never as HTML. `CommentQuote` is the quoted text, clamped to two
lines, grey and struck through with an Outdated pill when its text changed or
was removed. Its `action` slot holds the thread's Resolve check at the chip's
right end; the check is hidden until the card is hovered, holds keyboard focus
or is selected (always shown where there is no hover), and moves to the first
message's header when a thread shows no quote, where it joins the ⋯ pill and
stays while that message is deleted or being edited. A suggestion's discussion is the same
`CommentThread` with `embedded` on both clients (`EmbeddedThread` on the
desktop). Thread cards (and the suggestion cards beside them) use
`commentCardClass(selected)`: `bg-background` on the grey rail, with hover and
selection shown as a border colour change (`foreground/25` on hover, so it shows
in light mode too). Every name and time row is a `CommentByline`. The name gets its own 24px
line. If the time, "· edited" or a "New" badge doesn't fit after it, it moves
to the next line, so nothing is cut to a fragment and the name never moves. A
time wider than the whole row wraps at its spaces. A name is cut with an
ellipsis only when it doesn't fit its line, and when the name is alone on that
line, the room kept for the pill counts against it. A suggestion's
Inserted or Deleted tag sits outside the byline, and "Waiting to send" goes on
its own line under the body. In a message header the ⋯ menu, and the Resolve
check in a thread without a quote, share one tinted pill at the end of the
header's last item. Its real width (one or two buttons) is kept free beside the
time, "· edited", New or the deleted text, and the two wrap together, so the
pill never covers text. Hover, keyboard focus (not a mouse click) or an open
menu shows it, so nothing moves; touch screens always show it. Keeping that room
free makes a wrapped header on a mouse screen 2–6px taller. A resolved thread's "Resolved by
…" line wraps instead of cutting the name, and it breaks inside a name with no
spaces so the name stays in its column. If a long Reopen label would squeeze
the summary, Reopen moves under it. Times and other small meta text use `foreground/60`,
which clears 4.5:1 on the grey rail. The exact edit time sits in
the "· edited" Tooltip as a plain date and time, without the board's "Edited"
prefix, because the label already says it.
`CommentComposer` takes its labels, members, length limit and error text from
the kit. It is a bordered box with the text on top and one row under
it: the format buttons (B, I, S, code, list, and @ where people can be
mentioned) that wrap the selection in the same Markdown, Cancel on transient
composers, and the round ArrowUp send button (Check when saving an edit). The
⌘ Enter shortcut shows only in the send button's Tooltip. The button stays
hoverable while the box is empty or sending (`aria-disabled`, not `disabled`),
so the Tooltip always works. A failed send keeps the text
and shows "Not sent." with the reason, plus Retry when the host says retrying
can help. The kit has no strings of its own: the host wraps it in a
`CommentKitProvider` with its labels, time formats, names, error text,
confirm dialog and reaction support (`DesktopCommentKit` on the desktop,
`WebCommentKit` in the web client). An error line under an action is an
`InlineAlert` from `ui/inline-alert.tsx`. `Popover` takes an optional `open`
for callers that must close it themselves, as the reaction picker does.

Live states come from the same kit. A `CommentEntry` can carry a `delivery`:
`waiting` (clock, "Waiting to send", muted body, nothing to act on) or `failed`
(muted body, a red "Not sent." line with the host's reason, Copy text, Discard
and Retry only when the host passes one). A deleted entry is a grey trash
avatar with no name or time, and `removed` reads as a moderator removal; a
host that sets `moderate` on the kit gets a "Remove…" item with a confirm on
other people's messages. A "+N" on a reaction pill counts everyone else who added
that emoji, and counts each person once. If someone takes their reaction back,
they drop out of the count, and adding it again doesn't count them twice. Each emoji keeps its own 2.5 s: another person adding the same
emoji adds to it and restarts that emoji's clock, while a reaction on a
different emoji never stretches it. It fades out at the end. `CommentScrollArea` (`comment-arrivals.tsx`) is the
scroll box for a comments or chat list: it keeps the reader's place when items
land above them (measured from the box's own top, so a banner or composer
appearing above the box doesn't move the list), and lets what the reader opens
or types grow downward instead of pushing it above the top. Only growth
below the spot the reader clicked or typed counts as theirs. For 300 ms after
a click, so does the region the clicked control names in `aria-controls`: the
replies a toggle opens above itself, or the text a quote's Show more opens.
This lasts until 1 s after the first such change, or up to 5 s while the click
hasn't changed anything yet. Changes don't start that 1 s while the section is
marked `aria-busy`, so a file group that shows a spinner first and loads slowly
still opens downward. Once the control the reader used is gone (a reply box
closed with Escape, Cancel or Send, or the Reply link that opened it), nothing
more counts as theirs. A co-author's change above that spot, a collapse, or
anything else that changes above the reader still keeps their place. If the
item it's holding disappears, it holds the next item on screen, or the control
the reader just used when nothing else is left ("Hide replies" in the last
thread). If a re-sort moves the item it holds, it holds the items that kept
their order, or the box the reader is typing in. It tints other people's new items with `bg-comment-highlight`
and a "New" badge until they have been on screen for 4 s, shows a floating
"N new" pill while they are out of view, and with `stickToBottom` follows a
chat that is scrolled to the end. `TypingLine` (`comment-presence.tsx`) is the
"is replying"/"is typing" line with avatars and three dots that stop under
reduced motion; the kit's `activity` and `presence` feed carry it. A thread
reads its own repliers with `useReplyingIn(threadId)` and chat reads
`useChatTyping()`, so someone typing never redraws the other threads. A composer
reports `onActivity` while it has text, refreshing every 2 s and stopping 6 s
after the last keystroke, on blur, send or cancel. `CommentFilterMenu`
(`comment-filter.tsx`) is the Open / Resolved / All menu with counts.
`CommentsEmpty` (`comment-empty.tsx`) is the compact `EmptyState` with the
message-bubble tile, `CommentKeys` the ⌘ ⌥ M keycaps (Ctrl Alt M off macOS)
and `CommentsFootnote` the grey note under the list for viewers.
`CommentsOfflineQueue` is the banner for comments still waiting to be sent. Mention
options show a role and a green "here now" dot: `mergeMentionPeople` lists the
people here first, then other members, then non-members.

Commented text and quotes use the comment tokens: `--comment-highlight` and
`--comment-underline` for a commented range, `--comment-active` and
`--comment-active-underline` for the open thread, and `--comment-ink` for quote
text (`bg-comment-highlight`, `text-comment-ink` and so on in Tailwind).
`commentMarkStyle()` in `ui/comments/comment-mark-styles.ts` draws the tint
with its 2px underline, and CodeMirror marks use `COMMENT_RANGE_STYLES` from
the same file. Indigo is the default; Settings › Appearance › Comment
highlight color sets `data-comment-color` on the root (`graphite`, `leaf` or
`accent`) to swap the set. Comments never use yellow or amber. `--success`
(`text-success`) is the green for a resolved check and the "here now" dot.

`WorkspaceBanner` from `ui/workspace-banner.tsx` takes a `tone`: `primary`,
`neutral` (grey, for offline and information notices such as unsent comments)
or `warning`.

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

A menu that floats over selected text gets its position from
`placeAboveSelection(anchor, bounds, box)` in `ui/selection-placement.ts`. The
menu goes above the selection if it fits inside `bounds` and below it if it
doesn't, and it never leaves `bounds` sideways. `useMeasuredBox` in the same
file returns a ref for the menu and the menu's size after each render.

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

## Text smoothing

On macOS, `-webkit-font-smoothing: antialiased` makes dark text on a light
background thinner and paler than the rest of the system draws it. Light text
on a dark background looks better with it. The `--font-smoothing` token picks
the right one for each surface. `:root` sets `auto` and `.dark` sets
`antialiased`. A theme preset or a custom background sets it from how light
that background is (`applyThemeCustomization` and `applyEditorColors`), each
`[data-editor-theme]` block sets the value for its own background, and the
editor and Notes code blocks read it from there. Don't set
`-webkit-font-smoothing` or the `antialiased` class anywhere else. A new
surface whose background can differ from the app's mode sets
`--font-smoothing` itself.

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

`src/styles/globals.test.ts` fails on a `-webkit-font-smoothing` value or an
`antialiased` class outside the token, and on an editor theme whose smoothing
doesn't match its background.

`src/components/layout/SidebarSection.test.tsx` checks that every panel
registered in `src/contributions/tabs.tsx` renders `SidebarPanelHeader`, and
that no file other than `SidebarSection.tsx` writes its own sidebar title
style.

When a guard fails, switch the code to the primitive it names. If the
primitive can't do what the screen needs, extend the primitive and its test.
Copying its classes is the thing the guard exists to stop.

# Notes

A note is a Markdown file that you write in a rich editor. It can hold math,
tables, images, footnotes, callouts and drawn blocks such as charts, diagrams
and chemical structures. Notes link to each other and to projects, and the
assistant can read a note and suggest changes to it. Each note can be linked
to one project, and a project can also keep notes of its own.

Notes is experimental. It is off by default.

## Turning Notes on

Open Settings > Experimentation and switch on Notes. Everything on that page
is labelled as beta work that may change or be removed.

With Notes on:

- The Home dock gets a Notes button, and the command palette gets Open Notes.
- A project window gets a Notes panel in its side rail.
- The Notes keyboard shortcuts start working, and they appear in Settings >
  Keyboard Shortcuts.

Your notes are kept out of the project library while Notes is on. Switch it off
and they show up in the library again as Markdown projects. Nothing is deleted
either way.

## The Notes window

Notes opens over the whole app. The sidebar on the left holds the library, and
the rest of the window holds tabs. Drag a tab to an edge of a panel to split it,
and the layout is remembered the next time you open Notes. The Oleafly Notes
button at the top of the sidebar goes to Notes Home. Press it again on Notes
Home to go back to your projects. When the sidebar is hidden, the Home button
left of the tabs takes you straight back to your projects. The bar over an open
note shows Home, the note's project and its title. Home replaces the note with
Notes Home in the same tab.

A panel with no tabs shows a start page. Home and New note are at the top
right. Below today's date and a greeting are tiles for a blank note and the
first five research templates, and More templates opens the whole list.
Continue shows the four notes you edited last, with Search all notes beside it.
With no notes yet you see only the greeting and the tiles.

Next to the brand button are Search and New note. Search, or Command-Option-F
(Ctrl-Shift-A on Windows and Linux), turns the top row into the search box. Esc
clears it and puts the brand back. While the box has text it stays open when
you click elsewhere, so you can open one result after another.

The bar at the bottom of the sidebar has Today's note, Go to note, the graph,
New from template and a More menu with Markdown import, export and Dead links.
On its right are a button that switches between the light and dark themes, and
Settings, which opens the Notes tab of the appearance settings.

### Back and Forward

Back and Forward are the arrows next to the sidebar button. They work like the
ones in a web browser, and each tab has its own history. Opening a note from
Home or from Go to note adds a step, and so do Home in the bar over a note and
a switch to another Home tab such as Tasks. Going somewhere new after Back drops
the steps that were ahead. A note opened in a new tab starts a history of its
own.

Back puts a note at the spot you scrolled to. Deleted notes are skipped.
Right-click either arrow to list the steps in that direction and jump to one.
Each tab keeps its last 50 steps, and they are still there after you quit.

On macOS the keys are Command-[ and Command-]. On Windows and Linux they are
Alt-Left and Alt-Right. The side buttons on a mouse work too.

### Notes Home

Home lists your notes in one of three layouts: a grid of cards, a list or a
table. Tabs pick what is shown: My notes, Favorites, Tasks or Attachments. In
the grid and list layouts you can sort by Last opened, Last edited, Date
created or Title. The table layout sorts by its column headers instead, and
"Add or remove columns" adds a column for any property your notes use.

When you have no notes yet, Home offers New note, New from template and Import
Markdown.

### Tasks

The Tasks tab on Home lists the tasks from all your notes: every line that
starts with `- [ ]` or `- [x]`, whether it sits in a list, a quote or a callout.
A row shows the task with its due date, scheduled date and priority, the tags
written on that line, and the note it comes from. Click the note's name to open
it.

The menus above the list pick open or done tasks and filter by due date
(overdue, today, the next 7 days or no date), priority, tag and project. A tag
filter also matches tasks in notes tagged with it. Words typed in the search box
keep the tasks whose text or note title has them. The sort menu orders tasks by
due date or by priority, and tasks without a due date come last. The filters and
the sort are remembered on this computer.

Checking a task off writes the change into its note. When the note is open, the
change goes straight into the editor, so it doesn't show up as a suggested
change.

### Attachments

The Attachments tab on Home lists the files in your notes' `assets` folders:
images, audio, video, PDFs, tables, molecule files, notebooks and anything else
stored there. Each row shows the image itself, or an icon for other files, then
the file name, its size and the note it belongs to.

Use the menus above the list to show one type (Images, Audio, Video, PDFs or
Other) or only the files marked Not used. A file is Not used when its note no
longer shows it or links to it, for example after you delete an image from the
note. Notes never deletes these files. Show in folder takes you to the file if
you want to remove it. Words typed in the search box keep the files whose name
or note title has them.

Click the note's name to open the note at the block that uses the file. Copy
link copies a Markdown link to the file, relative to its note.

The list is read when you open the tab, so with many notes it can take a moment
the first time.

### The library and search

The sidebar groups notes by the project they are linked to. Notes without a
project sit under Notes. Right-click a note, or use its More button, for the
note menu: Open in new tab, Share, Copy link, Duplicate, Version history,
Export, Add to favorites, Rename, Use as template, Link to project and Delete.
If cloud sync made a conflict copy of a note, its menu also has Compare
conflict copy.

Delete moves the note to the Recycle Bin. It stays in Data Storage until you
restore it or delete it for good. Its open tabs close, as if you had closed
them yourself. A note that disappears some other way, because another program
or a sync tool removed the file, keeps its tab with a line saying the note is no
longer in your library. The file may only be moving. Favorites are remembered
on this computer only.

The search box searches titles, aliases and the text of every note. It also
takes filters:

| Filter | Matches |
| --- | --- |
| `tag:lab` | Notes tagged `#lab`, including nested tags such as `#lab/2024` |
| `title:` | Words in the title or an alias |
| `project:` | Notes linked to that project |
| `author:agent`, `author:you` | Notes an agent wrote, or notes you wrote |
| `is:favorite` | Your favorites |
| `kind:` | Notes, or a kind of research task file |

The Tags section at the foot of the sidebar shows each tag as a badge, with
the number of notes that carry it. Nested tags show their full path, such as
`#lab/2024`. Click a badge, or press Enter or Space on it, to filter by that
tag. Click it again to stop. Type in the box at the top to narrow the badges,
and press Escape to empty it. The box only looks at tag names, not at your
notes. If you have more than 30 tags, Show all lists the rest. Under the tags,
the kind buttons (shown while Research tasks is on) and the Written by buttons
filter the list too. While any filter is on, Clear filters sits at the right
end of the Written by row.

When the search has a tag filter, typed as `tag:` or picked in the Tags section, each
note in the list shows the blocks that carry the tag: list items, paragraphs,
table rows, headings and quotes. A note shows its first five blocks, and Show
more lists the rest. Click a block to open the note at that block.

The button at the right end of the search box picks how the words you type
are matched:

| Mode | How it matches |
| --- | --- |
| Best match | Ranks notes by how well they match. The words can be anywhere in the note. |
| Exact text | The exact characters, like ripgrep's fixed-string search. A capital letter in the text makes it match case. |
| Regular expression | ripgrep's regular expression syntax, one line at a time. Put a pattern in quotes when it has spaces or brackets. |
| Fuzzy | Titles and aliases that have the letters in order, as fzf does. `'word` matches exactly, `^word` the start, `word$` the end and `!word` leaves notes out. |

AND, OR, NOT, `-`, parentheses and the filters above work in every mode. A
pattern that isn't valid says so instead of showing results. The mode is
remembered on this computer.

### Go to note

Go to note (Command-O, or Ctrl-O on Windows and Linux) finds a note by title or
alias. With nothing typed, it shows the notes you opened recently. Enter opens
the note in the current tab, and Command-Enter or Ctrl-Enter opens it in a new
tab. When nothing matches, it offers to create a note with the name you typed.

### Daily notes

Today's note (Command-Shift-D, or Ctrl-Shift-D) opens the note titled with
today's date, such as `2026-11-09`, and creates it from the Daily note template
if it does not exist yet. A dated daily note shows previous and next buttons
under its title that step to the nearest daily notes you already have. They
never create a note.

### Calendar

The Calendar section at the foot of the sidebar shows one month, with today
filled in your accent colour (blue unless you changed it). A dot in that colour
under a day means it has a daily note, and an amber ring means tasks are due
that day. On today the dot and the ring take the colour of the number, so you
can still see them. Screen readers read the marks out with each day.

Click a day to open its daily note, or to create it if there isn't one yet. A
week number opens that week's note, and the arrows beside the month step back
or forward one month. To jump further, click the month's name. The picker
shows a year with arrows to change it and the twelve months under it. This
month is filled and the month on show is shaded. Click a month to go there.
The picker also opens the monthly note, or creates it when monthly notes are on
and there isn't one yet. When you are looking at another month, Today in the
picker or under the calendar takes you back. The section folds like Tags,
and stays open or closed the way you left it.

Weeks start on the day your region usually starts them, such as Sunday in
the United States and Monday in the United Kingdom and most of Europe. The
region comes from your computer's language setting, so English (UK) starts
weeks on Monday even though the app's English is the same. The "Week starts
on" setting, described below, picks Monday, Sunday or Saturday instead. Week
numbers count from that day. With Monday they are ISO week numbers, so week 1
has the year's first Thursday. With Sunday or Saturday, week 1 is the week with
January 1. Dates such as Today and Tomorrow always follow your computer's time
zone.

Settings > Appearance > Notes has a section for daily, weekly and monthly notes,
with the week start at the top. Each kind has a title format, the template a
new note starts from, a tag, and a switch to turn it off. When a kind is off,
the calendar and Today's note no longer create it, but a note you already have
still opens. Out of the box, daily notes are titled like `2026-11-11` and
tagged `daily`, weekly notes like `2026-W46` and tagged `weekly`, and monthly
notes like `2026-11` and tagged `monthly`. A title format uses `YYYY`, `MM`,
`MMMM`, `DD`, `dddd`, `WW` and `GGGG` for the date parts, and text in square
brackets stays as written.

### Quick capture

Quick capture is a small floating note for getting a thought down without
leaving the app you're in. Press Command-Shift-Option-Space on a Mac, or
Ctrl-Shift-Alt-Space on Windows and Linux, from any app. It stays on top of
your other windows and shows only your text until you move the pointer over it.
Type / for headings, lists and blocks, or click T for the formatting bar.

Press Command-Return (Ctrl-Enter) to save it as a new note. The note takes its
title from the first line, which the window shows at the top as you type. When
daily notes are on, Shift-Command-Return (Ctrl-Shift-Enter) adds the text to
the end of today's note instead, and creates that note from the Daily note
template first if it doesn't exist yet. The Command button or Command-K
(Ctrl-K) opens a menu with both of these, plus Copy as Markdown and Discard
draft. The plus button saves what you wrote and starts a blank note. The
notebook button opens Notes in the main window. Escape closes the window and
keeps what you typed for next time.

The shortcut works while Oleafly is running, even when its windows are in the
background. Change it or turn it off in Settings > Keyboard Shortcuts. The
command palette has Quick capture too.

Wayland doesn't let apps listen for keys outside their own windows, so on a
Wayland desktop the setting shows a command instead. Bind that command to a key
in your system keyboard settings and it opens the same window.

### Templates

New from template opens a picker with three groups:

- Research templates: Daily note, Experiment log, Paper reading notes,
  Literature review matrix, Meeting notes, Lab protocol, Weekly research log,
  Research proposal, Proof or derivation, Data analysis report, Interview
  notes, Screening log and Lab notebook entry. Each one fills in a body,
  properties and tags.
- Your templates: any note you marked with Use as template in its menu. The
  note gets a `template: true` property. When you start a note from it, the
  placeholders `{{title}}`, `{{date}}`, `{{time}}` and `{{weekday}}` in its
  title and text are filled in.
- From a reference: type part of a title, an author or a key, and the picker
  lists matching entries from the bibliography of the project you have open,
  plus your Zotero library if Zotero is connected. Picking one starts a Paper
  reading notes note with the authors, year, venue, DOI and citation key filled
  in. If you already have a note for that key, it opens that note instead.

Go to note shows the same From a reference matches when you type.

## Writing

The editor saves on its own while you type. The note header shows Saving,
Saved or Not saved, and a failed save offers Retry.

The title sits above the text. Hover over it for Add icon, which picks an
emoji or an icon and a color for the note. Properties shows the note's front
matter as fields you can edit. You'll find it in the Info panel, or under the
title when note info is inline (see [Note info](#note-info)). A property can
be Text, List, Number, Checkbox, Date or Note link. If the front matter is not
valid YAML, Properties says so and offers Fix it in Markdown instead of the
fields.

### The toolbar

From left to right:

- Undo and Redo.
- Block type: Text and Heading 1 to Heading 6.
- Quote and Code block.
- List: Bullet list, Numbered list and Task list.
- Bold, Italic, Underline, Strikethrough and Add link.
- Inline code and Highlight. Highlight offers yellow, orange, red, pink,
  purple, blue and green, plus Remove highlight, and one note can mix them.
  Yellow is saved as `==text==`. The other colors are saved as
  `<mark data-color="green">text</mark>`, which most Markdown apps also show
  as a highlight.
- Superscript and Subscript.
- Inline math and Display math, and Citation when the note is linked to a
  project.
- Table, Insert footnote, Divider, Chart, Mermaid diagram and Insert block.
- Insert image and Attach file, in personal notes.
- Note width (Standard, Wide or Full width) and Outline, which jumps to a
  heading.
- The word count, if it is switched on.

When the window is narrow, groups that do not fit move into a More menu. With
the cursor in a code block, Code language appears and picks the syntax colors.
With the cursor in a table, Table tools appears, with rows and columns above, below,
left and right, column alignment and Delete table. With an image selected, Alt
text and Image size appear. Image size sets the image to its own size or to
25, 50, 75 or 100 percent of the note's width.

Typing `/` at the start of an empty line opens the same inserts as a menu:
headings, lists, quote, callout, table, code, math, divider, footnote, the
drawn blocks and Attach file. Some Markdown also turns into formatting as you
type: `==text==` becomes highlighted text, `$x^2$` becomes inline math, and `$$`
on an empty line becomes display math.

Some character pairs turn into symbols as you type: `->` becomes →, `<-` ←,
`=>` ⇒, `!=` ≠, `<=` ≤, `>=` ≥, `+-` ±, `...` … and `--` —. Text in code or
math stays as typed, even before you type the closing backtick or dollar sign.
Backspace right after a swap puts back what you typed. Settings > Appearance >
Notes > Replace as you type turns this off, and the list below it adds or
removes pairs, up to 100 of them. A pair can begin with another pair: add `-->`
and it still works, even though `--` has already turned into — by the time you
type the `>`. Three hyphens on an empty line still make a divider.

The keyboard shortcuts for marks and lists are in
[Keyboard shortcuts](KeyboardShortcuts.md#notes). Command-F or Ctrl-F opens find
and replace for the note.

### Dates, task fields and the @ menu

Type @ anywhere in a note to open a menu of dates, task fields, tags and notes.
Pick a date inside a task and it becomes the task's due date, written as
`[due:: 2026-11-12]`. Anywhere else the date is written as
`[date:: 2026-11-12]`. Due date, Scheduled date and Priority open a second list
where you choose the value, and Custom field lets you name a field of your own.
Typing `@status:: in review` and pressing Enter does the same in one go.

Fields are written as inline fields in the `[key:: value]` form, which other
Markdown tools already read. The editor shows each one as a chip, with dates in
your language's format. A built-in date field such as due or scheduled shows a
calendar icon in place of its name, and hovering over the chip shows the name.
A due date turns amber on the day it's due and red after that, scheduled dates
are blue, and the dates in a done task are dimmed. To change how chips look,
pick a tint, an outline or a dotted underline in Settings > Appearance > Notes >
Date and field chips. Click a chip to change it or remove it. Typing a whole
field, brackets included, also turns it into a chip.

### Images and attached files

Insert image and Attach file copy a file into the note's `assets` folder and
put it in the note. Dropping or pasting a file does the same. A note can hold
images, audio (MP3, WAV, M4A, AAC, OGG, Opus and FLAC), video (MP4, M4V, WebM,
MOV and OGV), PDFs, tables (CSV, TSV or Excel), molecule files (PDB, SDF, CIF,
MOL, MOL2 and XYZ) and Jupyter notebooks. A table, molecule or notebook arrives
as the matching drawn block. Files over 64 MB are not added.

Drag the bar on the right edge of an image to resize it, and double-click the
bar to put the image back to its own size. The size is saved after the image
as `{width=50%}`, the way Pandoc and Quarto write it, so exports and Send to
paper keep it.

Audio and video are written like images, `![](assets/talk.mp4)`, and show a
player. The file loads when you press play, so a note with many recordings still
opens quickly. Playback uses the codecs on your computer. When a file's format
can't play, the block says so, and Show in folder takes you to the file so you
can open it in another player. On Linux the codecs come from GStreamer, and
MP4, M4V, MOV, M4A and AAC files usually need the gst-libav package.

A PDF shows its first page, or the page named in the link, as in
`![](assets/paper.pdf#page=3)`. In a project note, Open PDF under the page
opens the whole file in the project's PDF viewer. In other notes, use Show in
folder to find the file.

Paste a YouTube or Vimeo link on an empty line and Notes asks how to show it:
Embed video or Keep as link. An embedded video is saved as
`![](https://youtu.be/…)` and plays in the note when you click it, in
YouTube's privacy-enhanced player or Vimeo's player with tracking turned off.
The player sits inside a small page that Oleafly serves on this computer at
`127.0.0.1`, and that page can load nothing but those two players. Nothing
loads from YouTube or Vimeo before you press play, apart from the video's
picture, and that only once you allow images from the site, as for any image
from the web. Point at the video, or tab to it, and the site's logo shows along
its bottom edge, with the video's title when Notes knows it. Watch, on the
right, opens the video in your browser. That row hides once the video starts
playing.

Undo keeps working on a note after you close it or quit the app. The history
stays on this computer and holds your last few thousand edits. It is dropped if
the note changed somewhere else in the meantime or you delete the note, and
after 30 days without an edit. Settings > Appearance > Notes > Keep undo after
closing turns this off and deletes the history kept so far.

An image from the web is not loaded until you allow it. Click Load image on
the placeholder, or use the menu next to it to load every image in the note or
to always load images from that site. The sites you always allow are listed in
Settings > Appearance > Notes, under Images from the web.

### Bookmark cards

Paste a link to a web page on an empty line and Notes asks how to show it:
Bookmark card or Keep as link. (YouTube and Vimeo links get Embed video
instead.) Bookmark card reads the page once and fills in its title, a short
description, the site's name and icon, and its picture. Click the card, or
press Enter on it, to open the page in your browser. To make a card from an
address you type, use `/bookmark`.

While the page loads, the card shows the address and a spinner. If the page
can't be reached, the card still shows the address and the site's domain.

A card is saved as a fenced block, which other Markdown apps show as text:

````markdown
```bookmark
url: https://example.com/article
title: Example article
description: One line of text
image: https://example.com/og.png
site: Example
```
````

Only fields the page gave are written, one per line. `favicon:` holds the
site's icon. The picture and the icon come from the web, so they appear only
after you allow images from that site, the same as other images in a note.
Until then the card shows text only. Export and Send to paper turn a card into
a link with the page's title.

### Footnotes, callouts and math

Insert footnote adds the next number at the cursor and its definition at the
end of the note. The reference shows as a raised marker.

A callout is a quote whose first line names a type, such as
`> [!warning] Check the cable`. There are 24 types: Note, Abstract, Info, To do,
Tip, Success, Question, Warning, Failure, Danger, Bug, Example and Quote, plus
the theorem-style Theorem, Lemma, Corollary, Proposition, Definition, Proof,
Hypothesis, Assumption, Result, Method and Remark. A `-` after the type, as in
`> [!proof]- Proof`, makes the callout start folded. Settings > Appearance >
Notes has four callout styles.

Math is written in LaTeX. Select a formula and press Enter to edit its source.

## Blocks

A drawn block is a fenced code block whose fence names its kind, for example
`chart`. Insert block in the toolbar lists them in five groups: Data,
Math, Diagrams, Code and Science. The Source button on a block shows the text
behind it, and Preview goes back to the drawing. While the source is showing,
an information button next to the block's name gives a short example of how to
write it.

| Block | Fence | What it shows | Limits |
| --- | --- | --- | --- |
| Chart | `chart` | A bar, line, area, scatter, pie, donut or histogram chart from JSON, with optional error bars and a log scale. Show data opens the numbers as a table. | Up to 8 series. |
| Plot | `plot` | Curves such as `y = x^2 - 1` or `x = cos(t), y = sin(t)`, with `domain:` and labelled `point:` lines. | Up to 8 curves and 50 points. |
| Table | `csv` or `tsv` | A table you can sort and filter, with count, mean, min and max for number columns. The rows can be in the block, or `path:` can read a `.csv`, `.tsv`, `.xlsx` or `.xls` file in the note's folder. | Files up to 6 MB. |
| LaTeX | `latex` | Display math such as an `align` environment, with `\ce` for chemistry and `\pu` for units. | Math only, not a full LaTeX document. |
| Typst | `typst` | A Typst snippet drawn as an image. | Needs the desktop app. Packages from the internet are not available. |
| Mermaid | `mermaid` | A Mermaid diagram. | A diagram that loads images or styles from the internet is not drawn. |
| D2 | `d2` | A D2 diagram with shapes, containers, connections and `direction:`. | Uses the dagre layout. The `elk` layout and imports of other files are not available, and icons from the internet are not shown. |
| TikZ | `tikz` | A TikZ picture, or bare TikZ commands, compiled by the LaTeX engine that ships with Oleafly. | Needs the desktop app and a sandbox. Shell escape is off. |
| CircuiTikZ | `circuitikz` | A circuit drawn with CircuiTikZ. | Needs the desktop app and a sandbox. Shell escape is off. |
| SVG | `svg` | One `svg` element. | Scripts, links and remote images are removed. |
| HTML | `html` | A full page or a fragment with CSS and scripts. | Scripts start only when you click Run. It has no internet access, so the data must be in the block. |
| React | `jsx` | One component file with a default export. | Runs only when you click Run. It can import react, recharts, d3, lodash, papaparse, chart.js and lucide-react, and nothing else. |
| Chemical structure | `smiles` | 2D structures from SMILES strings, one per line, with optional names. | Up to 24 per block. |
| 3D molecule | `molecule` | A rotatable 3D view of a PDB, SDF, MOL, XYZ, CIF or MOL2 file, with cartoon, stick, sphere and line styles. | Needs WebGL. Files up to 6 MB. |
| Sequence | `sequence` | DNA, RNA or protein from FASTA or a raw sequence, with its length, GC content, reverse complement and translation. | Very long sequences are cut short on screen. |
| Jupyter notebook | `notebook` | The cells and saved outputs of a notebook file in the note's folder. `cells: 2-5` picks a range and `code: hide` hides the code. | Shows the outputs saved in the file. Format 4 notebooks only, up to 64 MiB. |
| Bookmark | `bookmark` | A link card with the page's title, description, site and picture. See Bookmark cards above. | Pictures load only from sites you allow. |

The notebook block is not in the Insert block menu. Add one by attaching an
`.ipynb` file.

### D2 blocks

D2 runs inside Oleafly, so D2 blocks draw offline. The first one you open in a
session takes about a second to start, and the rest draw at once. The diagram
follows the app's light or dark theme, unless the block sets its own theme in
`d2-config`. A mistake in the source shows D2's first error and its line
number.

### TikZ and CircuiTikZ blocks

Oleafly compiles these blocks with its bundled LaTeX engine and shows the
result as a vector image, so it stays sharp when you zoom. In dark mode the
image is inverted, as Typst blocks are. A block can hold:

- Bare drawing commands, which Oleafly wraps in a `tikzpicture` or
  `circuitikz` environment.
- A whole environment.
- A full document with `\documentclass`, compiled as written.

Lines above the picture, such as `\usetikzlibrary{positioning}`,
`\usepackage{pgfplots}` or `\ctikzset{...}`, go in the preamble. If a
CircuiTikZ block loads `circuitikz` with options of its own, for example
`\usepackage[american]{circuitikz}`, Oleafly uses those. Compile errors point
at the line in the block. The first drawing can take a while if the engine has
to fetch packages. Oleafly keeps finished drawings, even after a restart.

Lines every block should have go in Settings > Appearance > Notes > LaTeX
drawings > TikZ preamble. They come before each block's own preamble lines,
open blocks redraw when you change them, and an error in them names their
line. A full document with `\documentclass` doesn't use them.

LaTeX runs in an operating system sandbox for these blocks. It can write only
to the drawing's own temporary folder and its package cache, and it can't read
your files. On a computer where Oleafly has no sandbox, the blocks show an
error instead of a drawing. On Linux, installing bubblewrap fixes that.

In a shared note these blocks still wait until you click Draw. Draw compiles
that exact source, and the block asks again after the source changes. Until
you draw it, an export or Send to paper leaves the figure out. A LaTeX paper
still gets the TikZ source.

HTML and React blocks run in a separate frame and need the desktop app. Next to
Run, "Always run this block" lets that exact block start by itself in this note
on this computer. Change the block's source and it waits for Run again. Shared
notes never offer it. If a block froze or closed the app, the next time you
open that note its blocks wait for Run, even the ones set to always run.

## Links between notes

Type `[[` and part of a title to link to another note or to a project. Add `#`
and part of a heading to link to that heading, and `|` to show different text.
If no note matches, the menu offers to create one. Type `![[` instead to embed
another note, or one of its sections, in place. An embedded note can be folded.

A link is stored as an ordinary Markdown link to an `oleafly://note/` address
that uses the note's id, so it keeps working after you rename the note. Copy
link in the note menu copies that address. Hovering over a link shows a preview
of the note.

### Links to blocks

A block is a paragraph, a list item, a heading, a table, a quote or callout,
or a code or drawn block. A block can have an ID, which the Markdown keeps as
` ^id` at the end of a paragraph, list item or heading, or as `^id` on its own
line after a table, quote, list or code block.

Hover over a block and click the handle to its left for Copy link to block.
Command-Shift-L, or Ctrl-Shift-L on Windows and Linux, copies a link to the
block the cursor is in. Both give the block an ID first if it has none. The
link looks like `oleafly://note/<note id>#^<block id>`.

In the `[[` menu, type `#^` after a note's name to pick one of its blocks, or
`[[#^` for a block in the note you are in. If the block you pick has no ID,
it gets one, and for another note Oleafly writes the ID into that note's file.
`![[` with a block embeds just that block.

Opening a block link scrolls to the block and tints it for a moment. Hovering
over a block link previews only that block.

A block that other notes link to shows a count after it. Click the count, or
the block's handle, to see which notes link there. In Linked from, the
paragraph button next to a note jumps to the block it links to.

Paste a block link into a project's assistant, or into a CLI agent's chat,
and the text of the block is sent with your message. The search box
(Command-Shift-F, or Ctrl-Shift-F) lists notes with the blocks in them that
match, and `/notes` searches only notes.

### Dead links

Dead links, in the More menu at the bottom of the sidebar, opens a tab that lists
every link to a note that no longer exists and every link to a block that is
no longer in its note. Each row shows the note the link is in, the line it is
on and the text around it. Click a row to open the note at the link.

- Create note makes a note named after the link and points the link at it.
- Link to the note instead, for a missing block, keeps the link but drops the
  block.
- Remove link keeps the text and removes the link.

Typing `#` followed by a word makes a tag. Tags can also live in the `tags`
property, and a `/` nests them, as in `#lab/2024`. Clicking a tag filters the
library by it.

A tag's colour comes from its name, so `#lab` has the same colour in the note,
the Tags section, the table and Tasks, and keeps it after a restart. `#Lab` and
`#lab` match. A nested tag such as `#lab/2024` gets its own colour.

With note info inline, the end of each note lists:

- References, for the citations in the note (see below).
- Linked from, the notes that link here.
- Mentioned in, the notes that name this one in plain text without a link.
  Link turns the first such mention into a link.

Click a list's heading to fold or open it. The number next to the heading is
how many entries it has. A folded list stays folded on every note, even after
a restart. While Mentioned in is folded, Oleafly doesn't look for mentions.

### Note info

The Info button in the note header (Command-Option-I, or Ctrl-Shift-T) opens a
side panel for the note you are working in. At the top are the dates the note
was created and last changed, its word, character and line counts, and a
reading time. Below them come Properties, Linked from, Mentioned in,
References, Dead links and Attachments. Each list folds the same way the ones
at the end of a note do. The panel switches when you move to another note, and
it is still open after a restart.

Settings > Appearance > Notes > Note info picks Side panel, the default, or
Inline. Inline puts Properties back under the title and References, Linked
from and Mentioned in back at the end of the note, and there is no Info
button. The shortcut then folds Properties.

### Graph and outline

Graph view (Command-Shift-G, or Ctrl-Shift-G) draws every note as a dot and
every link as a line. You can search it, filter it by tag, show or hide notes
without links, and show the projects your notes link to. The local graph
(Command-Option-G, or Ctrl-Shift-M) shows only the notes around the open one,
one or two steps out. Outline (Command-Option-O, or Ctrl-Shift-K) opens a side
panel with the open note's headings, and can stop at a heading level.

On the graph, the arrow keys move between notes, Enter opens one, plus and
minus zoom, and 0 fits the whole graph.

## Citations

Write a citation as `[@key]`. When the note is linked to a project, the key is
looked up in that project's bibliography. A known key gets a short author and
year label, and hovering over it shows the full reference. An unknown key is
underlined, and its tooltip says it is not in the linked project's
bibliography. If one of your notes has that key in its `citekey` property, the
label opens that note.

The Citation button in the toolbar lists the linked project's references. When
the linked project is also the one open and Zotero is connected, it searches
your Zotero library too, and picking a Zotero item adds it to the project's
bibliography. See [Citations](Citations.md) for Zotero setup.

The References list at the end of the note shows each cited entry. It is not
written into the Markdown.

## Notes that belong to a project

There are two ways to keep notes with a project.

A personal note lives in your Notes library. The project in the bar over a note
picks the project the note is linked to, or reads Choose project when there is
none. Link to project in the note menu does the same. The link is stored on
this computer only. The New project button
in the note header starts a new project and links the note to it.

A project note is a Markdown file inside the project, in its `notes` folder.
It travels with the project, so collaborators on a shared project get it too.

The Notes panel in a project window shows both:

- Project notes, with New project note. Each row has Copy to my notes, Rename
  and Delete. In a folder you opened in place, Delete moves the file to the
  Trash (the Recycle Bin on Windows). In a library project it removes the file
  for good.
- My notes, the personal notes linked to this project, with New personal note.
  Each row can move the note into the project, open it in Notes, or unlink it.
  Moving a note into the project sends your personal copy to the Recycle Bin
  and closes its tab in Notes.

A note opened from this panel shows as a tab in the project window. Insert
image and Attach file are not available in a project note there. The command
palette has Open notes for this project, New project note and New personal note
for this project.

## The assistant

Each note has an assistant at the bottom of the page. It reads the note and
can search your other notes. Changes it makes to the note arrive as suggested
changes for you to review. In a shared note it does not read or search your
personal notes.

Command-J or Ctrl-J opens the assistant, or folds it when its box is empty.
With text selected, the same shortcut puts the selection into the assistant as
a quote. The Ask agent button that appears over a selection does the same.

Type `/` in the assistant for research actions: Find citations, Proofread
selection, Rewrite selection, Make it shorter, Write a new paragraph, Add
comparison table, Add a figure and Summarize for the abstract. With nothing
selected, those two read Proofread the note and Rewrite the note.
Check claims against the code appears when the note is linked to a project.
Update from the latest run appears when that project has a research task run.

The built-in assistant, Oleafly Agent, uses the provider you set up in
Settings > AI Assistant. If you have a CLI agent installed, a switch at the top
of the assistant moves between the two. When the note is linked to a project, a
CLI agent works in that project's folder. Oleafly turns on the agent's own
read-only mode when it has one. An agent without one could change files in the
project, so Oleafly asks before each message is sent.

### Reviewing suggested changes

Suggested changes are marked in the text. A bar at the bottom of the note has
Accept and Reject for the current change, previous and next arrows, and Accept
all and Reject all when there is more than one. Command-Enter or Ctrl-Enter
accepts the current change. After you reject a change, Undo, or Command-Z or
Ctrl-Z, brings it back.

The same review is used when another program changes a note file while the
note is open. The difference appears as suggested changes, and the file keeps
what the other program wrote until you accept, reject or start typing. If you
had unsaved edits, the two are merged. If you close the note without reviewing,
the suggestions come back the next time you open it.

A note with suggestions waiting for review, whether from another program, the
assistant or an outside agent, shows a mark next to its title in the library
and on Home until you open it and review them.

## Version history

Version history in the note menu lists saved versions of a personal note.
Project notes do not have one.

A version is saved:

- When you press Save a version.
- When you press Accept all, just before the changes go in.
- When you restore an older version, just before it replaces the text.

Select a version to see what restoring it would change. Restore writes that
version's text into the note. Only the text changes. Attached files stay as
they are. Versions are kept outside the note's folder, in the same store as
project [checkpoints](Checkpoints.md).

## Send to paper and Export

### Send to paper

Send to paper copies a note into a paper you are writing. It is offered while a
project is open with one of its LaTeX, Typst or Markdown files active. Put the
cursor in that file where the text should go. Then use the Send to paper button
in the note header for the whole note, or the Send to paper button over a
selection for just that part, and press Send. Oleafly converts the text once and
inserts it at the cursor. The copy in the paper is not linked to the note
afterwards.

During the conversion:

- Images are copied into the paper's figures folder.
- Chart, plot, Mermaid, D2, chemical structure, Typst and SVG blocks are drawn
  into figure files, PNG for LaTeX and SVG for Typst and Markdown. A 3D
  molecule is drawn as a PNG picture.
- TikZ and CircuiTikZ blocks go into a LaTeX paper as their own source inside a
  `figure`, and the packages they need are added to the paper's preamble. A
  Typst or Markdown paper gets them as SVG figures.
- A LaTeX block becomes display math, and a Typst block is kept as Typst in a
  Typst paper.
- A callout becomes a quote, or a theorem-style environment when the LaTeX
  preamble defines one with that name.
- Citations become `\cite` in LaTeX.
- A bookmark card becomes a link with the page's title.
- Highlights and links to notes become plain text.

Other blocks, such as tables, HTML and notebooks, stay in the note, and the
paper gets a line in italics saying so.

### Export

Export is a button in the note header, right after Share, and a submenu in the
note menu. Both list the same choices. It saves one note as a Markdown folder,
a Word document (`.docx`), a web page (`.html`), LaTeX (`.tex`) or Typst
(`.typ`). The Markdown folder is the same single-note export described under
Markdown folders below. Copy as Markdown, at the end of the list, puts the
note's title as a heading and its text on the clipboard, without the front
matter.

The More button at the end of the note header opens the note menu with the
actions the header does not already show: Copy link, Duplicate, Version
history, favorites, Rename, Use as template, Link to project and Delete. Rename
there edits the title in the header.

For Word, HTML, LaTeX and Typst, drawn blocks become figures the same way as in
Send to paper. A LaTeX export keeps TikZ and CircuiTikZ blocks as source and
loads their packages in the preamble. Word and HTML files carry their images
inside.
A LaTeX or Typst export that has figures is saved as a `.zip` with a `figures`
folder. Citations to the linked project's bibliography appear as author and
year labels, with a References section at the end.

There is no PDF export yet.

### Markdown folders

Import Markdown, in the sidebar's More menu or on an empty Home, brings in a
folder of Markdown files or files you pick. Each file becomes a note. Links
between the files become note links, and linked files are copied in as
attachments. A link that matches no file stays as text, and files over 5 MB are
skipped. Block links such as `[[Note#^id]]` become block links to the
imported note, and the `^id` markers stay in the text. "Add folder names as
tags" tags each note with its folder, so a file in `Lab/2024` gets the tag
`Lab/2024`. Oleafly asks first when a folder holds more than 1,000 notes, or
when you have imported the same folder before. You can stop an import at any
time, and a stopped import adds no notes.

Export as Markdown folder saves the open note, or all notes, into a new folder
in a place you pick. The folder takes the note's title, or the name Oleafly
notes when you export them all. Each note becomes a Markdown file that links to
the others with `[[wikilinks]]`, block links included, as in `[[Note#^id]]`.
Attachments go into an `attachments` folder. A link to a project becomes plain
text.

## Where notes live

A personal note is a folder in Oleafly's data folder, under
`~/.oleafly/projects`. The folder holds:

- `note.md`, the note itself.
- `project.json`, with the note's name and the project it is linked to.
- `assets/`, for images and attached files.

A project note is a `.md` file in the project's `notes` folder, and its
attachments go in `notes/assets`. The panel lists a file there only when its
front matter says `kind: note`.

Both kinds are plain Markdown with YAML front matter. A new note starts like
this:

```markdown
---
title: Field notes
icon: lucide:flask-conical
color: mint
kind: note
id: 0b7f2c9e-5d1a-4e8b-9c3f-2a6d8e1f4b70
---
```

The `id` is what note links point at, so keep it when you edit a file by hand.
Properties, `tags` and `aliases` go in the same block. You can edit a note file
in another program while Oleafly is open. Changes show up in the note as
suggested changes (see [Reviewing suggested changes](#reviewing-suggested-changes)).

## Backups

With cloud sync connected, Oleafly also keeps dated backups of your notes in
the same Dropbox, Google Drive or S3-compatible storage. Sync keeps every
computer on the latest version, so a deletion or a bad edit syncs too. A backup
is a copy from a moment in time that later changes don't touch. Backups keep
running when **Sync on this computer** is off. They run only while Notes is
on, though. Switch Notes off and they stop, and their settings are hidden
until you switch it back on.

The settings are in Settings > Data Storage > Cloud sync, under Backups:

- **Back up automatically** is on by default, and **How often** picks every
  6 hours, every day or every week. A backup only uploads files that changed
  since the last one.
- **Keep** sets how many backups to keep, from 7 to 90. Older ones are deleted
  from your storage, along with any file only they used.
- **Include projects** adds your projects to the backup. It's off by default,
  because projects already sync with their checkpoints and can be large.
- **Back up now** starts one straight away.

Each computer keeps its own backups, and the list shows the backups of all your
computers. **Restore** on a backup lists what it holds. A note that's no longer
on this computer comes back as it was, links and all. A note that's still here
comes back as a copy named "(restored *date*)" with its own link id, so nothing
you have is replaced. **Restore the missing** brings back everything this
computer has lost in one go.

Notes shared through a collaboration server are kept by that server, so they
aren't in these backups. Git history, build output and checkpoints aren't
either.

## Shared notes

Share in the note header lets you write a note with other people through an
Oleafly collaboration server (see [Oleafly Server](collaboration-server.md)).
Other people's cursors show in the text. Live editing is on for one shared note at a
time. Another shared note shows "Live editing is on in another note" with an
Edit live here button. Someone who can only view a note sees "You can read this
note but not edit it", and the assistant cannot change it for them.

Notes in a shared project's `notes` folder are shared with everyone on the
project. Personal notes stay private. TikZ and CircuiTikZ blocks in a shared
note draw only after you click Draw.

### Publishing a note

The Publish tab in the Share dialog puts a read-only copy of the note on the
collaboration server at a public link. Anyone with the link can read it without
signing in. The copy is made like Export > Web page (.html): images, charts,
diagrams, math, Typst blocks and molecules are included, and HTML, React, CSV,
sequence and notebook blocks are left out. Publish again sends the current text
to the same link. Editing the note doesn't change the page, and the tab says
when the note has changed since it was published. Unpublish deletes the page.
Your published notes are listed on the server's card in Settings >
Collaboration.

The server's admin decides whether public note links are allowed, and they
are off until an admin turns them on. In a shared note only the owner can
publish. An admin or maintainer can also take a page down. The tab then says
so, and the note can't be published again until someone puts the page back.
Unpublishing a page that was taken down deletes the copy, but the note stays
blocked all the same. See
[Public note links](collaboration-server.md#public-note-links).

## Appearance

Settings > Appearance > Notes changes how notes look, with a preview:

- Text: typeface (sans serif, serif or monospace) or any installed font, text
  size, line height and paragraph spacing.
- Headings and title: heading typeface or font, heading size and title size.
- Layout: note width, Note info (Side panel or Inline), task checkbox shape
  (square or round), Show word count,
  Check spelling in notes, and Replace as you type with its list of pairs.
- Code: code font and code block colors.
- Colors: the note accent color, the callout style and how date and field
  chips look (tint, outline or underline).
- Images from the web: the sites whose images load without asking.

A changed setting shows a reset button in its own row. Reset to defaults at
the bottom of Appearance puts every appearance setting back, the Notes ones
included.

## Keyboard shortcuts

The Notes shortcuts can be changed in Settings > Keyboard Shortcuts. The full
list, with the editor keys, is in [Keyboard shortcuts](KeyboardShortcuts.md#notes).

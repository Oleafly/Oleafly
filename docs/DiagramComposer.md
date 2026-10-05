# Diagram composer

The diagram composer draws figures on a canvas and saves them as plain source
code you can edit anywhere. It writes TikZ for LaTeX documents, fletcher code
for Typst documents, and Mermaid flowcharts for Markdown documents.

## Choosing a language

Opening the composer from the home screen or the command palette shows a
chooser that asks what kind of document the diagram is for. The "Draw a
diagram" button in a document toolbar skips the chooser and uses the
document's language: TikZ in a `.tex` file, Typst in a `.typ` file, and
Mermaid in a Markdown file. The header shows the language as a small label
next to the file name. Importing a file written in another language switches
the composer to it. The composer imports `.tikz`, `.tex`, `.typ`, `.mmd` and
`.md` files.

## The same in every language

- The canvas has rectangles, rounded boxes, circles, ellipses, diamonds,
  parallelograms, text, connectors, fill and border colors, snapping, undo,
  and redo.
- The Code view holds the same drawing as source. Edit either side and the
  other one follows. The snippet buttons are the same in every language.
- Compile renders a preview at 1x, 2x or 3x on the chosen background. Errors
  show up in the preview pane. For Typst and Mermaid each error names its line
  in the Code view, and clicking it jumps there.
- Insert puts the diagram into the open document in that document's language.
  When the composer is set to a different language, the drawing is converted
  through the canvas first.
- Save to project writes `figures/<name>.<ext>` and a PNG. New project creates
  a diagram project in the composer's language.
- Download offers PNG, SVG for Typst and Mermaid, and the source in any of the
  three languages.
- Fix with AI sends the code and its errors, and asks for corrected code in the
  same language.
- Saved source files end with a one-line comment that holds the canvas model,
  so reopening a file restores the drawing exactly.

<div align="center">
  <img src="assets/readme/diagram-composer.png" alt="Oleafly Diagram Composer showing an editable research diagram on a canvas" width="100%" />
</div>
<p align="center"><em>Keep the canvas model and the generated source editable.</em></p>

## Typst mode

The Code view holds a complete fletcher snippet: the
`#import "@preview/fletcher:..."` line and a `#diagram(...)` call with its
`node(...)` and `edge(...)` items. The fletcher version follows the target
project's Typst version. Typst 0.13 and later get 0.5.8, Typst 0.12 gets
0.5.5, and older releases get 0.5.1.

Edits in the Code view are read back through Typst's own syntax tree, not
through pattern matching. The reader handles positions given as lengths or as
grid cells, names given as `<label>` or as strings, every canvas shape, fills,
strokes, dash styles, arrow marks such as `"-|>"` and `"->"`, bends, label
positions and sides, corner radius, and the diagram settings the composer
writes. Arguments can come in any order. An edge without coordinates connects
the nodes on either side of it, as it does in fletcher.

The reader keeps code the canvas cannot show. Imports, `#let` lines, wrappers
such as `#figure(...)`, extra diagram settings, and loops stay in the code
exactly as written. A node or edge you did not touch on the canvas keeps its
text. One you did touch keeps the options the canvas does not know about. A
notes button in the header lists what stays only in the code and what the
canvas shows approximately.

The preview runs the target project's pinned Typst with its package cache.
The first preview downloads fletcher from Typst Universe. When that download
cannot happen, for example in offline mode, the preview says the package is
missing instead of showing a generic error.

A Typst diagram project has a standalone `main.typ` whose page is sized to the
drawing. Compiling the project produces the diagram PDF, and the Draw view of
that file is the same canvas.

## Mermaid mode

The Code view holds a Mermaid flowchart. The composer writes node shapes,
links with labels, `style` lines for colors, and subgraphs for group boxes. It
reads all of that back, along with `classDef`, `class`, link chains, and `&`
groups. Mermaid lays the diagram out on its own, so canvas positions are not
part of the code. Statements the canvas does not model, such as `click` lines
and directives, stay in the code.

The preview uses the app's Mermaid renderer. Insert adds a fenced mermaid code
block to the Markdown document, and the Markdown preview draws that block
directly. The PDF needs an image, so the composer also saves a rendered PNG at
`figures/mermaid-<hash>.png`. The hash comes from the block's text, and the
Markdown compile swaps the block for that image. If you edit the block by hand
afterwards, the PDF shows the code until you insert or save the diagram from
the composer again.

## What the canvas cannot express

- TikZ: the notes list commands the reader does not model. A canvas edit
  rewrites TikZ from the canvas, so those commands are lost there.
- Typst: fletcher bends curved edges by an angle and attaches straight edges at
  node borders, so the exact canvas curve and the handle sides are
  approximations. Nodes without a width and height, grid coordinates, and
  formatted labels are shown approximately and kept in the code.
- Mermaid: positions, edge routing, and handle sides are left to Mermaid's
  layout.

## Engineering boundaries

- The diagram package is driven by its host. It does not import app stores,
  Tauri commands, or provider credentials.
- Each language is an entry in `packages/diagram/src/languages/` with a writer,
  a reader, file and standalone forms, insert text, the Fix with AI prompt, and
  the canvas label seeds.
- The host supplies compilation, Typst and Mermaid rendering, and file writes
  through typed ports.
- The saved source stays readable and editable outside Oleafly.

## Engineering anchors

- `packages/diagram/`: composer, canvas, inspector, language registry, and host
  interfaces.
- `packages/diagram/src/fletcher.ts` and `fletcher-reader.ts`: the fletcher
  writer and reader.
- `packages/diagram/src/mermaid.ts`: the Mermaid writer and reader.
- `src/components/diagram/`: application integration.
- `src-tauri/resources/pandoc/mermaid-figures.lua`: puts saved Mermaid figures
  into Markdown PDFs.
- `src/lib/ai-figure.ts`: optional AI figure operations.

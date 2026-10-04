# PDF preview

The preview surface is a PDF.js-backed reader embedded beside the source. It
can also open in a detached preview window. The preview is driven by the
compiled artifact and retains the last accepted PDF while a newer compile is
pending or has failed.

<div align="center">
  <img src="assets/readme/pdf-preview.png" alt="Oleafly PDF preview beside the source editor" width="100%" />
</div>
<p align="center"><em>Keep the source and the latest accepted PDF visible together.</em></p>

## Implemented controls

- Continuous scroll with virtualized page rendering.
- Single-page and two-page spread layouts.
- Previous page, next page, and direct page-number navigation.
- Zoom in, zoom out, fit to width, and fit to height.
- Fullscreen preview mode.
- Present the PDF as slides, from the start or from the current page. An
  optional presenter view shows the next slide, a timer, and speaker notes.
- Rotate clockwise by 90 degrees.
- Invert preview colors and restore the normal palette.
- Download the displayed PDF with a chosen filename.
- Document outline and in-document text search.
- Compile-log and preview tabs in the same surface.
- Password prompt for encrypted PDFs.
- Stale-preview indicator when the visible artifact is not current.

## Source navigation

When the active engine emits valid SyncTeX data, forward SyncTeX moves from the
editor to the corresponding PDF location and inverse SyncTeX moves from a PDF
click back to source. Engines that do not provide SyncTeX advertise that
capability as unavailable instead of showing a non-functional control.

For LaTeX, a click resolves to the smallest text line under the pointer. A
click in blank space takes the nearest line inside the smallest box around it,
so a click below the last paragraph of a chapter still opens that chapter. The
line number comes from the kern and glue records inside the text line, which
carry the source line each word was read from. A text line's own tag points at
the line that ended its paragraph, so it is only the fallback. Boxes whose input
has no file name, such as table of contents entries Tectonic reads from its
build folder, never become the target. Forward search uses the same records to
find the text line that holds the requested source line.

Typst sync does not use SyncTeX data. It goes through the Tinymist language
server and needs Typst 0.13 or newer (Tinymist 0.13.30 or newer). With an older
Typst, the engine reports sync as unavailable, the same as Markdown, and the
controls stay hidden.

Selecting text in the PDF never jumps to the source, so copying text leaves the
editor where it is. A single click jumps.

## Reliability rules

- A PDF result carries a project revision identity.
- A result is accepted only when its revision matches the current project.
- A newer failed compile does not erase the last accepted PDF.
- PDF bytes are transferred as binary IPC data, not base64 embedded in compile
  metadata.
- Rotation, password retry, and reload preserve the visible page where possible
  to avoid a disruptive jump during recovery.

## Implementation anchors

- `src/components/preview/PreviewPane.tsx`
- `src/components/preview/PreviewWindow.tsx`
- `src/components/pdf/PdfViewer.tsx`
- `src/features/synctex.ts`
- `src-tauri/src/synctex.rs`
- `src/features/typst-sync.ts`
- `src-tauri/src/typst_sync.rs`
- `src/store/pdf-view.ts`

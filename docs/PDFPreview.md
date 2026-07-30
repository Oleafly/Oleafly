# PDF preview

The preview surface is a PDF.js-backed reader embedded beside the source. It
can also open in a detached preview window. The preview is driven by the
compiled artifact and retains the last accepted PDF while a newer compile is
pending or has failed.

## Implemented controls

- Continuous scroll with virtualized page rendering.
- Single-page and two-page spread layouts.
- Previous page, next page, and direct page-number navigation.
- Zoom in, zoom out, fit to width, and fit to height.
- Fullscreen preview mode.
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
- `src/features/synctex/`
- `src/store/pdf-view.ts`

# Diagram composer

The diagram composer creates editable TikZ figures without turning diagrams
into a proprietary binary format.

## Implemented surface

- Visual canvas with rectangles, circles, ellipses, diamonds, text, connectors,
  fill and border colors, snapping, undo, and redo.
- Code view with LaTeX/TikZ syntax highlighting and snippet insertion.
- Live isolated figure compilation and preview.
- Insert as TikZ source or as a generated image.
- Saved `.tikz` source retains the diagram model for round-trip editing.
- Optional AI repair of figure compile errors and optional vision refinement.
- Fullscreen composer mode and project-local figure naming.

## Engineering boundaries

- The diagram package is UI- and host-driven; it does not import app stores,
  Tauri commands, or provider credentials.
- Compilation and file writes are supplied by the host through typed ports.
- The saved source remains readable and editable outside Oleafly.

## Engineering anchors

- `packages/diagram/`: composer, canvas, inspector, and host interfaces.
- `src/components/diagram/`: application integration.
- `src/lib/ai-figure.ts`: optional AI figure operations.

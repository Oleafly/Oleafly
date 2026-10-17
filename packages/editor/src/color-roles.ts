export const SYNTAX_ROLES = [
  "command",
  "structure",
  "heading",
  "formatting",
  "environment",
  "reference",
  "math",
  "value",
  "name",
  "link",
  "symbol",
  "comment",
] as const;

export type SyntaxRole = (typeof SYNTAX_ROLES)[number];

export const SURFACE_COLORS = ["background", "text", "lineNumbers", "selection"] as const;

export type SurfaceColor = (typeof SURFACE_COLORS)[number];

export type EditorColorId = SurfaceColor | SyntaxRole;

export const EDITOR_COLOR_IDS: readonly EditorColorId[] = [...SURFACE_COLORS, ...SYNTAX_ROLES];

const ROLE_PALETTE: Readonly<Record<SyntaxRole, string>> = {
  command: "--cm-tag",
  structure: "--cm-keyword",
  heading: "--cm-meta",
  formatting: "--cm-tag",
  environment: "--cm-tag",
  reference: "--cm-keyword",
  math: "--cm-string",
  value: "--cm-number",
  name: "--cm-variable",
  link: "--cm-string",
  symbol: "--cm-bracket",
  comment: "--cm-comment",
};

const SURFACE_THEME: Readonly<Record<SurfaceColor, { variable: string; fallback: string }>> = {
  background: { variable: "--cm-editor-bg", fallback: "var(--background)" },
  text: { variable: "--cm-editor-fg", fallback: "var(--foreground)" },
  lineNumbers: { variable: "--cm-gutter-fg", fallback: "var(--muted-foreground)" },
  selection: {
    variable: "--cm-selection",
    fallback: "var(--cm-selection-default, color-mix(in srgb, var(--primary) 30%, var(--background)))",
  },
};

function kebab(id: EditorColorId): string {
  return id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function isSurface(id: EditorColorId): id is SurfaceColor {
  return (SURFACE_COLORS as readonly string[]).includes(id);
}

export function editorColorVariable(id: EditorColorId): string {
  return `--cm-user-${kebab(id)}`;
}

export function effectiveColorVariable(id: EditorColorId): string {
  return isSurface(id) ? `--cm-surface-${kebab(id)}` : `--cm-syntax-${id}`;
}

export function themeColorValue(id: EditorColorId): string {
  if (isSurface(id)) {
    const { variable, fallback } = SURFACE_THEME[id];
    return `var(${variable}, ${fallback})`;
  }
  return `var(--cm-theme-${id}, var(${ROLE_PALETTE[id]}))`;
}

export function editorColor(id: EditorColorId): string {
  return `var(${effectiveColorVariable(id)})`;
}

export function resolvedEditorColor(id: EditorColorId): string {
  return `var(${editorColorVariable(id)}, ${themeColorValue(id)})`;
}

export function editorColorDeclarations(): Record<string, string> {
  return Object.fromEntries(
    EDITOR_COLOR_IDS.map((id) => [effectiveColorVariable(id), resolvedEditorColor(id)]),
  );
}


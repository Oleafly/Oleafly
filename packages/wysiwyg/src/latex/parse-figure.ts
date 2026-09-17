import type { JSONContent } from "@tiptap/core";
import { splitEnvironmentSource, splitTopLevel } from "./arguments";
import { parseInlineSource } from "./inline-source";
import type { ParseContext } from "./parse-inline";
import { isBareStatement, scanStatements, singleMandatory, type LatexStatement } from "./statements";

export type GraphicsCommand = "includegraphics" | "includesvg";

interface GraphicsStatement {
  command: GraphicsCommand;
  width: string | null;
  options: string | null;
  path: string;
}

interface FigureState {
  graphics: GraphicsStatement | null;
  centering: boolean;
  caption: string | null;
  label: string | null;
}

export function splitGraphicsOptions(optional: string | null): { width: string | null; options: string | null } {
  let width: string | null = null;
  const rest: string[] = [];
  for (const entry of optional === null ? [] : splitTopLevel(optional, ",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const match = /^width\s*=\s*(.*)$/su.exec(trimmed);
    if (match && width === null) width = match[1].trim();
    else rest.push(trimmed);
  }
  return { width, options: rest.length ? rest.join(",") : null };
}

function graphicsFromStatement(statement: LatexStatement, command: GraphicsCommand): GraphicsStatement | null {
  if (statement.starred || statement.mandatory.length !== 1) return null;
  const { width, options } = splitGraphicsOptions(statement.optional);
  return { command, width, options, path: statement.mandatory[0] };
}

function applyGraphics(state: FigureState, statement: LatexStatement, command: GraphicsCommand): boolean {
  if (state.graphics) return false;
  state.graphics = graphicsFromStatement(statement, command);
  return state.graphics !== null;
}

const FIGURE_HANDLERS: Record<string, (state: FigureState, statement: LatexStatement) => boolean> = {
  centering: (state, statement) => {
    if (state.centering || !isBareStatement(statement)) return false;
    state.centering = true;
    return true;
  },
  includegraphics: (state, statement) => applyGraphics(state, statement, "includegraphics"),
  includesvg: (state, statement) => applyGraphics(state, statement, "includesvg"),
  caption: (state, statement) => {
    const value = singleMandatory(statement);
    if (value === null || state.caption !== null) return false;
    state.caption = value;
    return true;
  },
  label: (state, statement) => {
    const value = singleMandatory(statement);
    if (value === null || state.label !== null) return false;
    state.label = value;
    return true;
  },
};

function figureState(statements: LatexStatement[]): FigureState | null {
  const state: FigureState = { graphics: null, centering: false, caption: null, label: null };
  for (const statement of statements) {
    const handler = Object.hasOwn(FIGURE_HANDLERS, statement.name) ? FIGURE_HANDLERS[statement.name] : null;
    if (!handler || !handler(state, statement)) return null;
  }
  return state.graphics ? state : null;
}

export function parseFigureEnvironment(source: string, context: ParseContext): JSONContent | null {
  const parts = splitEnvironmentSource(source);
  if (!parts || parts.name !== "figure") return null;
  const statements = scanStatements(parts.body);
  const state = statements ? figureState(statements) : null;
  if (!state?.graphics) return null;
  const caption =
    state.caption === null
      ? []
      : [{ type: "figureCaption", content: parseInlineSource(state.caption, context) }];
  return {
    type: "figure",
    attrs: {
      path: state.graphics.path,
      width: state.graphics.width,
      options: state.graphics.options,
      placement: parts.optional,
      centering: state.centering,
      label: state.label,
      graphicsCommand: state.graphics.command,
    },
    content: caption,
  };
}

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import type { CollaboratorSelection } from "./document-session";

export const setCollaboratorSelections = StateEffect.define<
  readonly CollaboratorSelection[]
>();

class CollaboratorCursorWidget extends WidgetType {
  constructor(private readonly collaborator: CollaboratorSelection) {
    super();
  }

  eq(other: CollaboratorCursorWidget): boolean {
    return (
      other.collaborator.replicaId === this.collaborator.replicaId &&
      other.collaborator.displayName === this.collaborator.displayName &&
      other.collaborator.colorToken === this.collaborator.colorToken
    );
  }

  toDOM(): HTMLElement {
    const color = collaboratorColor(this.collaborator.colorToken);
    const cursor = document.createElement("span");
    cursor.className = "cm-collaborator-cursor";
    cursor.style.setProperty("--collaborator-color", color);
    cursor.title = this.collaborator.displayName;
    cursor.setAttribute("role", "img");
    cursor.setAttribute("aria-label", `${this.collaborator.displayName}'s cursor`);
    const label = document.createElement("span");
    label.className = "cm-collaborator-label";
    label.textContent = this.collaborator.displayName;
    cursor.append(label);
    return cursor;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function collaboratorDecorations(
  stateLength: number,
  collaborators: readonly CollaboratorSelection[],
): DecorationSet {
  const ranges = collaborators.flatMap((collaborator) => {
    const anchor = clamp(collaborator.anchor, stateLength);
    const head = clamp(collaborator.head, stateLength);
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const color = collaboratorColor(collaborator.colorToken);
    const values = [];
    if (from !== to) {
      values.push(
        Decoration.mark({
          class: "cm-collaborator-selection",
          attributes: {
            style: `--collaborator-color:${color}`,
            title: `${collaborator.displayName}'s selection`,
            "aria-label": `${collaborator.displayName}'s selection`,
          },
        }).range(from, to),
      );
    }
    values.push(
      Decoration.widget({
        widget: new CollaboratorCursorWidget(collaborator),
        side: head === stateLength ? -1 : 1,
      }).range(head),
    );
    return values;
  });
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(ranges, true);
}

const collaboratorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let mapped = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setCollaboratorSelections)) {
        mapped = collaboratorDecorations(transaction.state.doc.length, effect.value);
      }
    }
    return mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function collaborationDecorations(): Extension {
  return [
    collaboratorField,
    EditorView.baseTheme({
      ".cm-collaborator-selection": {
        backgroundColor: "color-mix(in srgb, var(--collaborator-color) 24%, transparent)",
      },
      ".cm-collaborator-cursor": {
        borderLeft: "2px solid var(--collaborator-color)",
        display: "inline-block",
        height: "1.25em",
        marginLeft: "-1px",
        pointerEvents: "none",
        position: "relative",
        verticalAlign: "text-bottom",
        width: "0",
        zIndex: "20",
      },
      ".cm-collaborator-label": {
        backgroundColor: "var(--collaborator-color)",
        borderRadius: "3px 3px 3px 0",
        color: "white",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: "10px",
        fontWeight: "600",
        left: "-2px",
        lineHeight: "16px",
        maxWidth: "140px",
        overflow: "hidden",
        padding: "0 5px",
        position: "absolute",
        textOverflow: "ellipsis",
        top: "-16px",
        whiteSpace: "nowrap",
      },
    }),
  ];
}

export function collaboratorColor(token: string): string {
  const palette = ["#16a34a", "#0284c7", "#7c3aed", "#db2777", "#ea580c", "#0891b2"];
  let hash = 2166136261;
  for (const character of token) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return palette[(hash >>> 0) % palette.length];
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(value, maximum));
}

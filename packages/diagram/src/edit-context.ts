import { createContext, useContext } from "react";

/** Lets a node start/commit inline label editing without threading callbacks
 *  through React Flow's node data (which would break memoization). */
export interface DiagramEditApi {
  editingId: string | null;
  beginEdit: (id: string) => void;
  commitLabel: (id: string, label: string) => void;
  cancelEdit: () => void;
}

export const DiagramEditContext = createContext<DiagramEditApi | null>(null);

export function useDiagramEdit(): DiagramEditApi {
  return (
    useContext(DiagramEditContext) ?? {
      editingId: null,
      beginEdit: () => {},
      commitLabel: () => {},
      cancelEdit: () => {},
    }
  );
}

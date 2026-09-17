import { Facet } from "@codemirror/state";
import type { VisualPorts } from "./types";

export const visualModeActive = Facet.define<boolean, boolean>({
  combine: (values) => values.length > 0 && values[0],
});

export const visualPortsFacet = Facet.define<VisualPorts, VisualPorts | null>({
  combine: (values) => values[0] ?? null,
});

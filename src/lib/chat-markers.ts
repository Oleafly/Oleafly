// Notes the assistant appends to a reply ("stopped", "step limit", "output
// limit"). They are stored in English, because the model reads them on the
// next turn, and shown in the reader's language.

export const STOPPED_MARKER = "_Stopped._";
export const STEP_LIMIT_MARKER =
  "_Reached the step safety limit. You can continue by sending another message._";
export const OUTPUT_LIMIT_MARKER =
  "_The reply reached the model's output limit. Send another message to continue._";

/** The marker as its own paragraph after the content. */
export function appendMarker(content: string, marker: string): string {
  return (content ? `${content}\n\n` : "") + marker;
}

export interface MarkerLabels {
  stopped: string;
  stepLimit: string;
  outputLimit: string;
}

/**
 * Stored markers in the reader's language. Only a marker that stands alone
 * as a paragraph is replaced; the same words inside other text stay.
 */
export function localizeMarkers(content: string, labels: MarkerLabels): string {
  const replacements: [string, string][] = [
    [STOPPED_MARKER, labels.stopped],
    [STEP_LIMIT_MARKER, labels.stepLimit],
    [OUTPUT_LIMIT_MARKER, labels.outputLimit],
  ];
  if (!replacements.some(([marker]) => content.includes(marker))) return content;
  return content
    .split("\n\n")
    .map((paragraph) => {
      const found = replacements.find(([marker]) => paragraph.trim() === marker);
      return found ? `_${found[1]}_` : paragraph;
    })
    .join("\n\n");
}

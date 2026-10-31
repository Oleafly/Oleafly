export const SOURCE_CONTROL_SHOW_GRAPH_EVENT =
  "oleafly:source-control-show-graph";

const GRAPH_REQUEST_TTL_MS = 5_000;

let graphRequestedAt: number | null = null;

export function showSourceControlGraph() {
  graphRequestedAt = Date.now();
  window.dispatchEvent(new CustomEvent(SOURCE_CONTROL_SHOW_GRAPH_EVENT));
}

export function consumeSourceControlGraphRequest() {
  const requestedAt = graphRequestedAt;
  graphRequestedAt = null;
  return (
    requestedAt !== null && Date.now() - requestedAt < GRAPH_REQUEST_TTL_MS
  );
}

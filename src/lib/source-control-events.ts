/**
 * Requests that Source Control reveal its Git graph after the rail has been
 * selected. This is intentionally a browser event: commands do not import a
 * rail panel, and the panel remains responsible for its own expansion state.
 */
export const SOURCE_CONTROL_SHOW_GRAPH_EVENT =
  "oleafly:source-control-show-graph";

const GRAPH_REQUEST_TTL_MS = 5_000;

let graphRequestedAt: number | null = null;

export function showSourceControlGraph() {
  graphRequestedAt = Date.now();
  window.dispatchEvent(new CustomEvent(SOURCE_CONTROL_SHOW_GRAPH_EVENT));
}

/**
 * Lets Source Control handle a Graph request that was issued while its rail
 * panel was not mounted yet. This keeps command-palette navigation reliable
 * without coupling commands to the panel's state.
 */
export function consumeSourceControlGraphRequest() {
  const requestedAt = graphRequestedAt;
  graphRequestedAt = null;
  return (
    requestedAt !== null && Date.now() - requestedAt < GRAPH_REQUEST_TTL_MS
  );
}

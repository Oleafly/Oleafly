// Citation.js imports its Node transport even in browser builds, then selects
// the browser transport at runtime. Keep that unused branch out of the Tauri
// bundle and expose only the standards-based globals it actually reads here.
function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof globalThis.fetch !== "function") {
    return Promise.reject(new Error("Browser fetch is unavailable."));
  }
  return globalThis.fetch(input, init);
}

export const Headers = globalThis.Headers;
export default browserFetch;


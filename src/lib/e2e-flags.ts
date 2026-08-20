// Testability hooks (window.__e2e* adapters, data-e2e-* attributes, canned
// seeds) exist in dev builds and in the packaged e2e build the CI suite runs
// (VITE_E2E_HOOKS=1 at build time, see scripts/e2e.sh). Vite statically
// replaces both env reads, so release builds tree-shake the hooks away.
export const E2E_HOOKS = import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === "1";

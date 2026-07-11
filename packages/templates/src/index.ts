/**
 * @openleaf/templates — the template gallery (new-project wizard). Template
 * data, previews, and asset downloads are injected via TemplatesHost; UI
 * primitives via TemplatesKit. No store, Tauri, or app imports. (The template
 * bundles themselves live in the Rust resources, not here.)
 */
export { NewProjectDialog } from "./NewProjectDialog";
export type { TemplateInfo, TemplatesHost, TemplatesKit } from "./types";

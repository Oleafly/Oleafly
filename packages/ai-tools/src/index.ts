/**
 * @openleaf/ai-tools — the AI agent toolsets (project editing tools + the
 * figure studio tools). All app services are injected via AiToolsHost; no
 * store, Tauri, or app imports.
 */
export {
  createOpenLeafTools,
  createFigureTools,
  type AiToolsHost,
  type ProjectIndexView,
  type IndexDefView,
  type IndexUseView,
  type ToolApprovalRequest,
  type ConfirmFn,
} from "./tools";
export { pickPagesToVerify } from "./pick-pages";

// The implementation lives in `@openleaf/ai-tools` so the `verify_pdf_pages`
// tool and the app share one definition; re-exported here so existing
// importers and the unit test keep working.
export { pickPagesToVerify } from "@openleaf/ai-tools";

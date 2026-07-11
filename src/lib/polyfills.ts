// The pdf.js WebView polyfills live with the PDF engine package; this shim
// keeps the `@/lib/polyfills` import in main.tsx (must run before pdf.js loads).
import "@openleaf/preview/polyfills";

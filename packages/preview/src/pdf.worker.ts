// pdf.js worker entry. The worker runs in its own JS realm, so it needs the
// same `Map.prototype.getOrInsert*` polyfills as the main thread (pdf.js v6
// uses them in the worker too, and older WebViews lack them). Import the
// polyfill first, then the real pdf.js worker, which registers its handlers.
import "./polyfills";
import "pdfjs-dist/build/pdf.worker.min.mjs";

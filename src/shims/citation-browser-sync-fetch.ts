// Synchronous network requests are never used by Oleafly's local citation
// formatter. The property is present because Citation.js uses it only for an
// `instanceof` check while normalizing optional request headers.
const unsupported = Object.assign(
  () => {
    throw new Error("Synchronous citation requests are unavailable in the desktop app.");
  },
  { Headers: globalThis.Headers },
);

export default unsupported;


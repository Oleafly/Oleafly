import { Cut, icon, SHEET } from "./base";

// The project sidebar's views.

export const OiFolder = icon("folder", (
  <>
    <path className="bs" d="M2 5.2a1.4 1.4 0 0 1 1.4-1.4h3.7l1.6 1.7h7.9a1.4 1.4 0 0 1 1.4 1.4v8.7a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 15.6z" />
    <path className="bf" d="M2 8.4a1.2 1.2 0 0 1 1.2-1.2h13.6a1.2 1.2 0 0 1 1.2 1.2v7.2a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 15.6z" />
  </>
));

export const OiSearch = icon("search", (
  <>
    <circle className="bw" cx="8.4" cy="8.4" r="5.6" />
    <path className="gl" d="M5.2 7.4a3.6 3.6 0 0 1 2.2-2.2" />
    <circle className="k thick" cx="8.4" cy="8.4" r="5.6" />
    <path className="k heavy" d="M12.6 12.6l4.6 4.6" />
  </>
));

export const OiSourceControl = icon("source-control", (
  <>
    <path className="o thick" d="M6 6.8v6.4M14 10c0 2.6-2.4 3.4-5.6 3.6" />
    <circle className="gs" cx="6" cy="4.4" r="2.4" />
    <circle className="gs" cx="6" cy="15.6" r="2.4" />
    <circle className="ps" cx="14" cy="7.6" r="2.4" />
    <path className="gl" d="M4.7 3.8a1.5 1.5 0 0 1 .9-.9M4.7 15a1.5 1.5 0 0 1 .9-.9M12.7 7a1.5 1.5 0 0 1 .9-.9" />
  </>
));

export const OiPreflight = icon("preflight", (
  <>
    <path className="of" d="M10 1.8c2.2 1.4 4.3 2 6.4 2.1v5.3c0 4.3-2.6 7.4-6.4 9-3.8-1.6-6.4-4.7-6.4-9V3.9c2.1-.1 4.2-.7 6.4-2.1z" />
    <path className="g heavy" d="M6.8 10.1l2.3 2.3 4.1-4.5" />
  </>
));

export const OiReferences = icon("references", (
  <>
    <Cut>
      <path className="of" d={SHEET} />
      <path className="o ln thick" d="M5.3 6.2h4.2M5.3 8.8h5.4M5.3 11.4h3.4" />
    </Cut>
    <circle className="bw" cx="13.6" cy="13.6" r="3.4" />
    <circle className="k thick" cx="13.6" cy="13.6" r="3.4" />
    <path className="k heavy" d="M16.2 16.2l1.8 1.8" />
  </>
));

export const OiResearch = icon("research", (
  <>
    <path className="of" d="M8.4 2.6h3.2v4.8l4.6 7.9a1.6 1.6 0 0 1-1.4 2.4H5.2a1.6 1.6 0 0 1-1.4-2.4l4.6-7.9z" />
    <path className="ps" d="M5.9 11.4h8.2l2.1 3.9a1.6 1.6 0 0 1-1.4 2.4H5.2a1.6 1.6 0 0 1-1.4-2.4z" />
    <circle className="glint" cx="8.8" cy="14.4" r="0.9" />
    <circle className="glint" cx="11.6" cy="15.8" r="0.6" />
    <path className="ol" d="M8.4 2.6h3.2v4.8l4.6 7.9a1.6 1.6 0 0 1-1.4 2.4H5.2a1.6 1.6 0 0 1-1.4-2.4l4.6-7.9z" />
    <path className="o thick" d="M7.2 2.6h5.6" />
  </>
));

export const OiCollab = icon("collab", (
  <>
    <path className="g thick half" d="M3.9 3.9a8.6 8.6 0 0 0 0 12.2M16.1 3.9a8.6 8.6 0 0 1 0 12.2" />
    <path className="g thick" d="M6.5 6.5a5 5 0 0 0 0 7M13.5 6.5a5 5 0 0 1 0 7" />
    <circle className="gs" cx="10" cy="10" r="2.4" />
  </>
));

export const OiComments = icon("comments", (
  <>
    <path className="yf" d="M4.2 3.2h11.6a1.8 1.8 0 0 1 1.8 1.8v7.6a1.8 1.8 0 0 1-1.8 1.8H9.6l-3.4 3v-3h-2a1.8 1.8 0 0 1-1.8-1.8V5a1.8 1.8 0 0 1 1.8-1.8z" />
    <path className="n thick" d="M5.6 7h8.8M5.6 10h6" />
  </>
));

export const OiChat = icon("chat", (
  <>
    <path className="of" d="M7.2 2.6h9.2a1.6 1.6 0 0 1 1.6 1.6v5.6a1.6 1.6 0 0 1-1.6 1.6h-.8v2.2L13 11.4H7.2a1.6 1.6 0 0 1-1.6-1.6V4.2a1.6 1.6 0 0 1 1.6-1.6z" />
    <path className="bs" d="M3.6 8.2h7.8a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6H7.2l-2.6 2.2v-2.2h-1a1.6 1.6 0 0 1-1.6-1.6v-5a1.6 1.6 0 0 1 1.6-1.6z" />
    <circle className="wf" cx="5.2" cy="12.3" r="0.6" />
    <circle className="wf" cx="7.5" cy="12.3" r="0.6" />
    <circle className="wf" cx="9.8" cy="12.3" r="0.6" />
  </>
));

export const OiPlug = icon("plug", (
  <>
    <path className="k heavy" d="M7.8 2.4v4M12.2 2.4v4" />
    <path className="bs" d="M5.2 6.4h9.6v3.2a4.8 4.8 0 0 1-9.6 0z" />
    <path className="gl" d="M6.6 8.2v1.4" />
    <path className="k heavy" d="M10 14.4v3.4" />
  </>
));

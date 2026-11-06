import { icon } from "./base";

// Settings sections. General, AI and Research reuse OiSettings, OiAssistant and OiResearch.

export const OiAppearance = icon("appearance", (
  <>
    <path className="of" d="M10 2.2a7.8 7.8 0 0 0 0 15.6c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6h1.9a4.4 4.4 0 0 0 4.4-4.4C18.7 5.3 14.8 2.2 10 2.2z" />
    <circle className="rs" cx="5.6" cy="9.2" r="1.4" />
    <circle className="ys" cx="7.6" cy="5.6" r="1.4" />
    <circle className="gs" cx="11.6" cy="4.9" r="1.4" />
    <circle className="bs" cx="14.8" cy="7.6" r="1.4" />
  </>
));

export const OiDictionary = icon("dictionary", (
  <>
    <rect className="pf" x="4" y="2.2" width="12.4" height="15.6" rx="1.4" />
    <path className="ps" d="M5.4 2.2h1.4v15.6H5.4A1.4 1.4 0 0 1 4 16.4V3.6a1.4 1.4 0 0 1 1.4-1.4z" />
    <path className="p thick half" d="M8.8 12.8h5.2M8.8 15h3.6" />
    <path className="ns" d="M11.6 2.2v5.6l1.4-1.1 1.4 1.1V2.2z" />
  </>
));

export const OiData = icon("data", (
  <>
    <path className="bs" d="M3.6 4.4v11.2c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4V4.4c0 1.3-2.9 2.4-6.4 2.4S3.6 5.7 3.6 4.4z" />
    <ellipse className="bf" cx="10" cy="4.4" rx="6.4" ry="2.4" />
    <path className="wh half" d="M3.6 8.2c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4M3.6 11.9c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4" />
  </>
));

export const OiEngine = icon("engine", (
  <>
    <path className="ol thick" d="M7.5 2.4V5M10 2.4V5M12.5 2.4V5M7.5 15v2.6M10 15v2.6M12.5 15v2.6M2.4 7.5H5M2.4 10H5M2.4 12.5H5M15 7.5h2.6M15 10h2.6M15 12.5h2.6" />
    <rect className="ks" x="4.6" y="4.6" width="10.8" height="10.8" rx="1.8" />
    <rect className="bs" x="7.4" y="7.4" width="5.2" height="5.2" rx="0.9" />
    <path className="gl" d="M6 7.2a1.6 1.6 0 0 1 1.2-1.2" />
  </>
));

export const OiDownloads = icon("downloads", (
  <>
    <path className="kf" d="M2.2 11.8h15.6v3.8a1.8 1.8 0 0 1-1.8 1.8H4a1.8 1.8 0 0 1-1.8-1.8z" />
    <circle className="gs" cx="14.8" cy="14.6" r="0.9" />
    <path className="o ln thick" d="M4.6 14.6h4" />
    <path className="bs" d="M8.7 1.8h2.6v4.6h2.6L10 10.4 6.1 6.4h2.6z" />
  </>
));

export const OiIntegrations = icon("integrations", (
  <>
    <rect className="ns" x="2.2" y="2.2" width="7" height="7" rx="1.6" />
    <rect className="bs" x="2.2" y="10.8" width="7" height="7" rx="1.6" />
    <rect className="gs" x="10.8" y="10.8" width="7" height="7" rx="1.6" />
    <rect className="ps" x="11.3" y="2.3" width="6" height="6" rx="1.5" transform="rotate(15 14.3 5.3)" />
  </>
));

export const OiCollaboration = icon("collaboration", (
  <>
    <circle className="kf" cx="13.8" cy="6" r="2.6" />
    <path className="kf" d="M9.6 16.4a4.2 4.2 0 0 1 8.4 0v.6H9.6z" />
    <circle className="bs" cx="7.2" cy="7.2" r="3" />
    <path className="bs" d="M1.8 17.4a5.4 5.4 0 0 1 10.8 0v.4H1.8z" />
    <path className="gl" d="M5.4 6.6a2 2 0 0 1 1.2-1.3" />
  </>
));

export const OiShortcuts = icon("shortcuts", (
  <>
    <rect className="of" x="1.6" y="4.8" width="16.8" height="10.6" rx="1.8" />
    <path className="o thick half" d="M4.4 8h.9M7.2 8h.9M10 8h.9M12.8 8h.9M15.2 8h.4M4.4 10.4h.9M7.2 10.4h.9M10 10.4h.9M12.8 10.4h.9M15.2 10.4h.4" />
    <path className="b thick" d="M6.4 12.8h7.2" />
  </>
));

export const OiExperiment = icon("experiment", (
  <>
    <path className="of" d="M13.2 2.8l4 4-8.6 8.6a2.83 2.83 0 0 1-4-4z" />
    <path className="gs" d="M6.6 9.4l4 4-2 2a2.83 2.83 0 0 1-4-4z" />
    <circle className="glint" cx="6.4" cy="13" r="0.7" />
    <path className="ol" d="M13.2 2.8l4 4-8.6 8.6a2.83 2.83 0 0 1-4-4z" />
    <path className="o thick" d="M12 1.6l6.4 6.4" />
  </>
));

export const OiDeveloper = icon("developer", (
  <g transform="scale(0.8333)">
    <path className="ks" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    <path className="gl" d="M13.4 4.2a3.6 3.6 0 0 1 2-.9" />
  </g>
));

export const OiHelp = icon("help", (
  <>
    <circle className="bs" cx="10" cy="10" r="7.8" />
    <path className="gl" d="M4.6 8a5.8 5.8 0 0 1 3.2-3.6" />
    <path className="wh heavy" d="M7.7 7.9a2.4 2.4 0 0 1 4.6.9c0 1.6-2.3 2-2.3 3.6" />
    <circle className="wf" cx="10" cy="14.6" r="1.1" />
  </>
));

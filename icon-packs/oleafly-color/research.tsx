import type { ReactNode } from "react";
import { Badge, Cut, icon, SPARKLE } from "./base";

// Drawn for the app-wide switch to Oleafly Icons.
// Reading and references, writing tools, learning, AI, measuring, scanning, and windows.

const withBadge = (base: ReactNode, badge: ReactNode) => (
  <>
    <Cut>{base}</Cut>
    {badge}
  </>
);
const Plus = () => <path className="wh thick" d="M14.3 12.4v3.8M12.4 14.3h3.8" />;
const Check = () => <path className="wh thick" d="M12.5 14.4l1.3 1.3 2.6-2.7" />;
const Cross = () => <path className="wh thick" d="M13 13l2.6 2.6M15.6 13 13 15.6" />;

/** An open book: a coloured cover behind two paper pages with text. */
const OpenBook = () => (
  <>
    <path className="bs" d="M1.8 5.4v11.2c3.6-.4 6.4 0 8.2 1.2 1.8-1.2 4.6-1.6 8.2-1.2V5.4z" />
    <path className="of" d="M10 5.2C8.4 4 6 3.6 2.6 3.8v11.4c3.4-.2 5.8.2 7.4 1.4z" />
    <path className="of" d="M10 5.2c1.6-1.2 4-1.6 7.4-1.4v11.4c-3.4-.2-5.8.2-7.4 1.4z" />
    <path className="o ln thick" d="M4.4 7h3.6M4.4 9.4h3.6M4.4 11.8h2.6M12 7h3.6M12 9.4h3.6M12 11.8h2.6" />
  </>
);

/** A closed hardback book with its page edge along the bottom. */
const ClosedBook = ({ hue }: Readonly<{ hue: "b" | "n" }>) => (
  <>
    <rect className={`${hue}s`} x="3.6" y="1.8" width="12.8" height="16.4" rx="1.6" />
    <path className="of" d="M16.4 14.2H5.7a1.6 1.6 0 0 0 0 3.2h10.7z" />
    <path className="gl" d="M5.4 3.6v8.6" />
  </>
);

const RIBBON = "M5.4 1.8h9.2a1.2 1.2 0 0 1 1.2 1.2v15.2L10 14.4l-5.8 3.8V3a1.2 1.2 0 0 1 1.2-1.2z";
const RIBBON_LEFT = "M4.4 1.8h5.8a1.2 1.2 0 0 1 1.2 1.2v15.2l-4.1-4-4.1 4V3a1.2 1.2 0 0 1 1.2-1.2z";
const BookmarkLeft = () => (
  <>
    <path className="bs" d={RIBBON_LEFT} />
    <path className="gl" d="M4.6 3.6v7" />
  </>
);

/** A tag lying point-left with its point at the origin. */
const TAG = "M0 0l5-5h9.6a1.4 1.4 0 0 1 1.4 1.4v7.2a1.4 1.4 0 0 1-1.4 1.4H5z";
const SMALL_TAG = "M0 0l4-4h7.8a1.2 1.2 0 0 1 1.2 1.2v5.6a1.2 1.2 0 0 1-1.2 1.2H4z";

/** Viewfinder corners around a scanned area. */
const SCAN_CORNERS =
  "M2.4 6.2V4.2a1.8 1.8 0 0 1 1.8-1.8h2M13.8 2.4h2a1.8 1.8 0 0 1 1.8 1.8v2M17.6 13.8v2a1.8 1.8 0 0 1-1.8 1.8h-2M6.2 17.6h-2a1.8 1.8 0 0 1-1.8-1.8v-2";

export const OiReader = icon("reader", <OpenBook />);

export const OiBookCheck = icon("book-check", withBadge(<OpenBook />, (
  <Badge hue="g">
    <Check />
  </Badge>
)));

export const OiBookAdd = icon("book-add", withBadge((
  <>
    <ClosedBook hue="b" />
    <path className="wh thick half" d="M7.6 5.4h5.6M7.6 8h3.6" />
  </>
), (
  <Badge hue="g">
    <Plus />
  </Badge>
)));

export const OiGlossary = icon("glossary", (
  <>
    <ClosedBook hue="n" />
    <path className="wh thick" d="M7.4 11.4 10 4.6l2.6 6.8M8.4 9h3.2" />
  </>
));

export const OiLibrary = icon("library", (
  <>
    <rect className="bs" x="1.8" y="4.2" width="3.4" height="12.8" rx="0.8" />
    <rect className="ps" x="6" y="2.2" width="3.6" height="14.8" rx="0.8" />
    <rect className="ns" x="13.4" y="4" width="3.4" height="13" rx="0.8" transform="rotate(-16 13.4 17)" />
    <path className="wh" d="M2.6 6.4h1.8M2.6 14.6h1.8M6.9 4.6h1.8M6.9 14.6h1.8" />
    <rect className="ks" x="1.6" y="17" width="16.8" height="1.4" rx="0.6" />
  </>
));

export const OiBookmark = icon("bookmark", (
  <>
    <path className="bs" d={RIBBON} />
    <path className="gl" d="M5.6 3.6v8" />
  </>
));

export const OiBookmarkCheck = icon("bookmark-check", withBadge(<BookmarkLeft />, (
  <Badge hue="g">
    <Check />
  </Badge>
)));

export const OiBookmarkAdd = icon("bookmark-add", withBadge(<BookmarkLeft />, (
  <Badge hue="g">
    <Plus />
  </Badge>
)));

export const OiBookmarkRemove = icon("bookmark-remove", withBadge(<BookmarkLeft />, (
  <Badge hue="r">
    <Cross />
  </Badge>
)));

export const OiLabel = icon("label", (
  <g transform="translate(2.6 2.6) rotate(45)">
    <path className="ns" d={TAG} />
    <path className="gl" d="M6.4-3.8h7.6" />
    <circle className="knock" cx="5.4" cy="0" r="1.5" />
  </g>
));

export const OiLabels = icon("labels", (
  <>
    <g transform="translate(6 2.2) rotate(45)">
      <path className="nf" d={SMALL_TAG} />
    </g>
    <g transform="translate(2.2 6.2) rotate(45)">
      <path className="ns" d={SMALL_TAG} />
      <path className="gl" d="M5.2-3h6" />
      <circle className="knock" cx="4.4" cy="0" r="1.25" />
    </g>
  </>
));

export const OiEquation = icon("equation", (
  <>
    <rect className="gf" x="2.4" y="2.4" width="15.2" height="15.2" rx="2.2" />
    <path className="g thick" d="M13.4 6.2v-.8H6.6l3.8 4.6-3.8 4.6h6.8v-.8" />
  </>
));

export const OiPenTool = icon("pen-tool", (
  <g transform="translate(10 10) rotate(135) scale(1.25) translate(-10 -10)">
    <path className="ks" d="M10 19.6 4.4 11l2.4-5h6.4l2.4 5z" />
    <path className="gl" d="M13.8 10.8l-1.6-3.4" />
    <path className="wh" d="M10 19V12.6" />
    <circle className="wf" cx="10" cy="11.4" r="1.1" />
    <rect className="bs" x="6.4" y="2.4" width="7.2" height="3" rx="0.9" />
  </g>
));

export const OiMagic = icon("magic", (
  <>
    <g transform="rotate(-45 8 12)">
      <rect className="ks" x="0.6" y="10.5" width="11" height="3" rx="1.5" />
      <rect className="ys" x="11" y="10.5" width="4.4" height="3" rx="1.5" />
    </g>
    <path className="ys" d={SPARKLE(15.2, 4.6, 3)} />
    <path className="ps" d={SPARKLE(8.2, 3.8, 2)} />
    <path className="ps" d={SPARKLE(16.4, 11.8, 1.8)} />
  </>
));

export const OiHighlighter = icon("highlighter", (
  <>
    <rect className="ys half" x="1.8" y="15.2" width="11.4" height="2.8" rx="1.2" />
    <g transform="rotate(45 10 10)">
      <rect className="ys" x="7" y="2" width="6" height="8.6" rx="1.4" />
      <path className="gl" d="M8.2 3.6v5.4" />
      <rect className="ks" x="7" y="10.6" width="6" height="1.6" />
      <path className="ns" d="M8 12.2h4v2.2l-4 2.2z" />
    </g>
  </>
));

export const OiEraser = icon("eraser", (
  <>
    <g transform="rotate(-40 10 10)">
      <path className="rs" d="M7.4 6.6v6.8H4.1a1.4 1.4 0 0 1-1.4-1.4V8a1.4 1.4 0 0 1 1.4-1.4z" />
      <path className="bs" d="M7.4 6.6h9a1.4 1.4 0 0 1 1.4 1.4v4a1.4 1.4 0 0 1-1.4 1.4h-9z" />
      <path className="gl" d="M8.6 8h7.6" />
    </g>
    <path className="k thick" d="M8.4 17.6h9" />
  </>
));

export const OiReadMode = icon("read-mode", (
  <>
    <circle className="bw" cx="5.6" cy="11" r="4" />
    <circle className="bw" cx="14.4" cy="11" r="4" />
    <path className="gl" d="M3.2 10.4a2.5 2.5 0 0 1 1.6-1.6M12 10.4a2.5 2.5 0 0 1 1.6-1.6" />
    <circle className="k thick" cx="5.6" cy="11" r="4" />
    <circle className="k thick" cx="14.4" cy="11" r="4" />
    <path className="k thick" d="M8.6 8.4c.9-.8 1.9-.8 2.8 0M2.2 8.8l-.5-3.2M17.8 8.8l.5-3.2" />
  </>
));

export const OiLearn = icon("learn", (
  <>
    <path className="bs" d="M5 9.4v4.2c0 1.5 2.2 2.6 5 2.6s5-1.1 5-2.6V9.4L10 11.8z" />
    <path className="bs" d="M10 2.8 18.4 7.2 10 11.6 1.6 7.2z" />
    <path className="gl" d="M4.6 6.8 9.4 4.4" />
    <path className="n thick" d="M16.4 8.2v5" />
    <circle className="ns" cx="16.4" cy="14" r="1.2" />
  </>
));

export const OiSchool = icon("school", (
  <>
    <path className="rs" d="M10 1.8l8.2 4.6H1.8z" />
    <rect className="of" x="2.6" y="6.4" width="14.8" height="1.8" rx="0.4" />
    <rect className="of" x="3.7" y="8.2" width="1.8" height="7" />
    <rect className="of" x="7.3" y="8.2" width="1.8" height="7" />
    <rect className="of" x="10.9" y="8.2" width="1.8" height="7" />
    <rect className="of" x="14.5" y="8.2" width="1.8" height="7" />
    <rect className="ks" x="1.8" y="15.2" width="16.4" height="2.8" rx="0.6" />
  </>
));

export const OiIdea = icon("idea", (
  <>
    <path className="ys" d="M10 1.8a5.8 5.8 0 0 0-3.5 10.42c.6.46.9 1.16.9 1.9v.48h5.2v-.48c0-.74.3-1.44.9-1.9A5.8 5.8 0 0 0 10 1.8z" />
    <path className="gl" d="M6.6 6.4a3.6 3.6 0 0 1 2.4-2.4" />
    <rect className="ks" x="7.4" y="15" width="5.2" height="1.5" rx="0.5" />
    <rect className="ks" x="8.1" y="16.8" width="3.8" height="1.4" rx="0.7" />
  </>
));

export const OiBrain = icon("brain", (
  <>
    <path className="ps" d="M9.6 4.6A2.4 2.4 0 0 0 5.4 4.4 2.6 2.6 0 0 0 2.8 8.2a2.5 2.5 0 0 0-.2 4.4 2.7 2.7 0 0 0 3 3.8 2.3 2.3 0 0 0 4 .2z" />
    <path className="ps" d="M10.4 4.6a2.4 2.4 0 0 1 4.2-.2 2.6 2.6 0 0 1 2.6 3.8 2.5 2.5 0 0 1 .2 4.4 2.7 2.7 0 0 1-3 3.8 2.3 2.3 0 0 1-4 .2z" />
    <path className="gl" d="M4 7.6a1.8 1.8 0 0 1 1.2-1.4M11.6 6.4a1.6 1.6 0 0 1 1.4-.6" />
    <path className="wh" d="M9.6 8.6c-1.6 0-2.6-1-2.6-2.4M2.8 10.4c1.6 0 2.8.8 2.8 2.4M9.6 13.2c-1.4 0-2.4.8-2.6 2M10.4 8.6c1.6 0 2.6-1 2.6-2.4M17.2 10.4c-1.6 0-2.8.8-2.8 2.4M10.4 13.2c1.4 0 2.4.8 2.6 2" />
  </>
));

export const OiBot = icon("bot", (
  <>
    <rect className="ks" x="1.6" y="9.4" width="1.8" height="4" rx="0.6" />
    <rect className="ks" x="16.6" y="9.4" width="1.8" height="4" rx="0.6" />
    <path className="o thick" d="M10 6.2V4.4" />
    <circle className="ys" cx="10" cy="3.2" r="1.4" />
    <rect className="ps" x="3.2" y="6.2" width="13.6" height="11.2" rx="3" />
    <path className="gl" d="M5 9a1.8 1.8 0 0 1 1.4-1.4" />
    <circle className="wf" cx="7.4" cy="11.2" r="1.4" />
    <circle className="wf" cx="12.6" cy="11.2" r="1.4" />
    <path className="wh thick" d="M8.4 14.4h3.2" />
  </>
));

export const OiCalculator = icon("calculator", (
  <>
    <rect className="ks" x="3.6" y="1.8" width="12.8" height="16.4" rx="2" />
    <rect className="gw" x="5.4" y="3.6" width="9.2" height="3.6" rx="0.8" />
    <circle className="wf" cx="6.8" cy="10" r="0.95" />
    <circle className="wf" cx="10" cy="10" r="0.95" />
    <circle className="wf" cx="13.2" cy="10" r="0.95" />
    <circle className="wf" cx="6.8" cy="13" r="0.95" />
    <circle className="wf" cx="10" cy="13" r="0.95" />
    <circle className="wf" cx="13.2" cy="13" r="0.95" />
    <circle className="wf" cx="6.8" cy="16" r="0.95" />
    <circle className="wf" cx="10" cy="16" r="0.95" />
    <circle className="ns" cx="13.2" cy="16" r="0.95" />
  </>
));

export const OiLanguages = icon("languages", (
  <>
    <rect className="of" x="1.8" y="1.8" width="10.2" height="10.2" rx="1.8" />
    <path className="o thick" d="M6.9 3.6v1.2M4.2 5h5.4M5 6.6c.9 2.2 2.4 3.4 4.4 4M8.8 6.6c-.9 2.2-2.4 3.4-4.4 4" />
    <rect className="bs" x="8.2" y="8" width="10" height="10.2" rx="1.8" />
    <path className="gl" d="M9.6 10.2a1.4 1.4 0 0 1 1.2-1.2" />
    <path className="wh thick" d="M10.7 16.2l2.5-6.2 2.5 6.2M11.6 14.2h3.2" />
  </>
));

export const OiTour = icon("tour", (
  <>
    <circle className="bf" cx="10" cy="10" r="8" />
    <path className="b thick half" d="M10 3.4v1.2M10 15.4v1.2M3.4 10h1.2M15.4 10h1.2" />
    <path className="rs" d="M14.2 5.8 11.3 11.3 8.7 8.7z" />
    <path className="ks" d="M5.8 14.2 8.7 8.7 11.3 11.3z" />
    <circle className="wf" cx="10" cy="10" r="0.8" />
  </>
));

export const OiLicense = icon("license", (
  <>
    <path className="k" d="M4.2 5.6 1.9 11.6M4.2 5.6l2.3 6M15.8 5.6l-2.3 6M15.8 5.6l2.3 6" />
    <rect className="ks" x="9.3" y="3.4" width="1.4" height="13" />
    <path className="ks" d="M5.4 18.2h9.2a.6.6 0 0 0 .6-.7 2.6 2.6 0 0 0-2.6-1.9H7.4a2.6 2.6 0 0 0-2.6 1.9.6.6 0 0 0 .6.7z" />
    <rect className="ks" x="2.8" y="4.8" width="14.4" height="1.5" rx="0.75" />
    <circle className="ns" cx="10" cy="3.2" r="1.4" />
    <path className="ns" d="M1.6 11.6h5.2a2.6 2.6 0 0 1-5.2 0z" />
    <path className="ns" d="M13.2 11.6h5.2a2.6 2.6 0 0 1-5.2 0z" />
  </>
));

export const OiTarget = icon("target", (
  <>
    <circle className="rs" cx="10" cy="10" r="8.2" />
    <circle className="wf" cx="10" cy="10" r="5.8" />
    <circle className="rs" cx="10" cy="10" r="3.4" />
    <path className="gl" d="M3.6 8.2a6.8 6.8 0 0 1 4.6-4.6" />
  </>
));

export const OiGauge = icon("gauge", (
  <>
    <circle className="of" cx="10" cy="10.4" r="7.9" />
    <path className="gs" d="M4.28 13.7A6.6 6.6 0 0 1 5.76 5.34L7.3 7.18A4.2 4.2 0 0 0 6.36 12.5z" />
    <path className="ns" d="M5.76 5.34A6.6 6.6 0 0 1 14.24 5.34L12.7 7.18A4.2 4.2 0 0 0 7.3 7.18z" />
    <path className="rs" d="M14.24 5.34A6.6 6.6 0 0 1 15.72 13.7L13.64 12.5A4.2 4.2 0 0 0 12.7 7.18z" />
    <path className="ks" d="M12.37 5.32 10.91 10.82 9.09 9.98z" />
    <circle className="ks" cx="10" cy="10.4" r="1.5" />
  </>
));

export const OiActivity = icon("activity", (
  <>
    <rect className="bf" x="1.8" y="2.6" width="16.4" height="14.8" rx="2.2" />
    <path className="b heavy" d="M3.8 10.4h2.6l1.8-4.2 3.4 8 1.8-3.8h2.8" />
  </>
));

export const OiChart = icon("chart", (
  <>
    <path className="k thick" d="M2.4 2.4v13.8a1.4 1.4 0 0 0 1.4 1.4h13.8" />
    <rect className="bs" x="5.4" y="9.4" width="3" height="6.2" rx="0.8" />
    <rect className="gs" x="9.6" y="4.2" width="3" height="11.4" rx="0.8" />
    <rect className="ns" x="13.8" y="7.4" width="3" height="8.2" rx="0.8" />
  </>
));

export const OiScanSearch = icon("scan-search", (
  <>
    <path className="b thick" d={SCAN_CORNERS} />
    <circle className="bw" cx="9.2" cy="9.2" r="3.4" />
    <path className="gl" d="M7.2 8.6a2.2 2.2 0 0 1 1.4-1.4" />
    <circle className="k thick" cx="9.2" cy="9.2" r="3.4" />
    <path className="k heavy" d="M11.8 11.8l2.6 2.6" />
  </>
));

export const OiOcr = icon("ocr", (
  <>
    <path className="b thick" d={SCAN_CORNERS} />
    <path className="o thick" d="M6 7h8M6 10h8M6 13h5" />
  </>
));

export const OiTextSearch = icon("text-search", (
  <>
    <path className="o thick" d="M2.4 3.6h15.2M2.4 7.6h7M2.4 11.6h4.6M2.4 15.6h4.6" />
    <circle className="bw" cx="12.8" cy="12.4" r="3.6" />
    <path className="gl" d="M10.7 11.8a2.4 2.4 0 0 1 1.5-1.5" />
    <circle className="k thick" cx="12.8" cy="12.4" r="3.6" />
    <path className="k heavy" d="M15.6 15.2l2.4 2.4" />
  </>
));

export const OiNetwork = icon("network", (
  <>
    <path className="o thick" d="M10 10 4.2 4.8M10 10l5.6-5.6M10 10l5.8 5.2M10 10l-4.8 5.8M4.2 4.8h11.4" />
    <circle className="bs" cx="4.2" cy="4.8" r="2.4" />
    <circle className="bs" cx="15.6" cy="4.4" r="2.4" />
    <circle className="bs" cx="15.8" cy="15.2" r="2.4" />
    <circle className="bs" cx="5.2" cy="15.8" r="2.4" />
    <circle className="ps" cx="10" cy="10" r="2.8" />
    <path className="gl" d="M8.4 9.4a1.7 1.7 0 0 1 1-1" />
  </>
));

export const OiShapes = icon("shapes", (
  <>
    <path className="ns" d="M10 1.8l4.6 7.8H5.4z" />
    <circle className="gs" cx="5.8" cy="14.3" r="3.9" />
    <rect className="bs" x="10.6" y="10.6" width="7.6" height="7.6" rx="1.6" />
    <path className="gl" d="M3.6 13.4a2.4 2.4 0 0 1 1.4-1.4M11.8 13a1.4 1.4 0 0 1 1.2-1.2" />
  </>
));

export const OiPresent = icon("present", (
  <>
    <rect className="bs" x="1.8" y="3" width="16.4" height="11" rx="1.8" />
    <path className="gl" d="M3.4 6.4a1.6 1.6 0 0 1 1.4-1.6" />
    <path className="wf" d="M8.4 6.2v5.6l4.6-2.8z" />
    <path className="o thick" d="M10 14v3M7 17.2h6" />
  </>
));

export const OiPictureInPicture = icon("picture-in-picture", (
  <>
    <rect className="of" x="1.8" y="3" width="16.4" height="14" rx="2" />
    <path className="o ln thick" d="M4.2 6.4h5M4.2 9h3.4" />
    <rect className="bs" x="9.4" y="9.4" width="7.2" height="6" rx="1.2" />
    <path className="gl" d="M10.6 11.6a1.2 1.2 0 0 1 1-1" />
  </>
));

export const OiWindow = icon("window", (
  <>
    <rect className="of" x="1.8" y="3" width="16.4" height="14" rx="2" />
    <path className="bs" d="M3.8 3h12.4a2 2 0 0 1 2 2v2.2H1.8V5a2 2 0 0 1 2-2z" />
    <circle className="wf" cx="4.4" cy="5.1" r="0.7" />
    <circle className="wf" cx="6.6" cy="5.1" r="0.7" />
    <circle className="wf" cx="8.8" cy="5.1" r="0.7" />
    <path className="o ln thick" d="M4.4 10.4h7.4M4.4 13.2h5" />
    <rect className="ol" x="1.8" y="3" width="16.4" height="14" rx="2" />
  </>
));

export const OiDashboard = icon("dashboard", (
  <>
    <rect className="bs" x="2" y="2" width="7" height="9" rx="1.7" />
    <rect className="of" x="11" y="2" width="7" height="5" rx="1.7" />
    <rect className="of" x="2" y="13" width="7" height="5" rx="1.7" />
    <rect className="gs" x="11" y="9" width="7" height="9" rx="1.7" />
    <path className="gl" d="M3.2 4.6a1.4 1.4 0 0 1 1.2-1.3M12.2 11.6a1.4 1.4 0 0 1 1.2-1.3" />
  </>
));

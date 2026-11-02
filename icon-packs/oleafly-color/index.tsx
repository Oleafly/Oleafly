import { Badge, Cut, FOLD, GEAR, icon, SHEET, SPARKLE } from "./base";

export type { OleaflyIcon } from "./base";
export { OleaflyIconDefs } from "./OleaflyIconDefs";
export * from "./workspace";
export * from "./settings";
export * from "./files";
export * from "./tree";
export * from "./documents";
export * from "./research";
export * from "./people";
export * from "./system";

export const OiSourceView = icon("source-view", (
  <>
    <Cut>
      <path className="of" d={SHEET} />
      <path className="of" d={FOLD} />
      <path className="o ln thick" d="M5.3 6.2h4.2M5.3 8.8h2.8" />
    </Cut>
    <Badge hue="b">
      <path className="wh thick" d="M12.8 12.6 11.2 14.3l1.6 1.7M15.8 12.6l1.6 1.7-1.6 1.7" />
    </Badge>
  </>
));

export const OiSplitView = icon("split-view", (
  <>
    <rect className="of" x="1.8" y="3" width="16.4" height="14" rx="2" />
    <path className="bw" d="M10 3h6.2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10z" />
    <path className="o ln thick" d="M3.9 6.6h4M3.9 9.2h4M3.9 11.8h2.8" />
    <path className="b thick" d="M12 6.6h4.2M12 9.2h4.2M12 11.8h2.8" />
    <path className="ol" d="M10 3v14" />
    <rect className="ol" x="1.8" y="3" width="16.4" height="14" rx="2" />
  </>
));

export const OiPdfView = icon("pdf-view", (
  <>
    <Cut>
      <path className="of" d={SHEET} />
      <path className="of" d={FOLD} />
      <path className="o ln thick" d="M5.3 6.2h4.2M5.3 8.8h2.8" />
    </Cut>
    <Badge hue="r">
      <path className="wh thick" d="M12.3 13h4M12.3 15.6h2.6" />
    </Badge>
  </>
));

export const OiExport = icon("export", (
  <>
    <path className="kf" d="M2.2 11.4h3.9l1.1 1.8h5.6l1.1-1.8h3.9v4.4a1.6 1.6 0 0 1-1.6 1.6H3.8a1.6 1.6 0 0 1-1.6-1.6z" />
    <path className="bs" d="M8.5 1.8h3v5.6h3L10 12.4 5.5 7.4h3z" />
  </>
));

export const OiFork = icon("fork", (
  <>
    <path className="o thick" d="M5.8 7.2v.9a2.4 2.4 0 0 0 2.4 2.4h3.6a2.4 2.4 0 0 0 2.4-2.4v-.9M10 10.5v2.6" />
    <circle className="gs" cx="5.8" cy="4.6" r="2.6" />
    <circle className="gs" cx="14.2" cy="4.6" r="2.6" />
    <circle className="bs" cx="10" cy="15.6" r="2.6" />
    <path className="gl" d="M4.4 3.9a1.6 1.6 0 0 1 .9-.9M12.8 3.9a1.6 1.6 0 0 1 .9-.9M8.6 14.9a1.6 1.6 0 0 1 .9-.9" />
  </>
));

export const OiHistory = icon("history", (
  <>
    <circle className="of" cx="10.6" cy="10.6" r="7.2" />
    <path className="b thick" d="M10.6 6.4v4.2l2.9 1.8" />
    <path className="n thick" d="M10.6 3.4A7.2 7.2 0 0 0 3.4 10.6M1.9 9.1l1.5 1.5 1.5-1.5" />
  </>
));

export const OiShare = icon("share", (
  <>
    <path className="of" d="M5 7.2h10a1.6 1.6 0 0 1 1.6 1.6v7.6A1.6 1.6 0 0 1 15 18H5a1.6 1.6 0 0 1-1.6-1.6V8.8A1.6 1.6 0 0 1 5 7.2z" />
    <path className="bs" d="M10 1.6l4.2 4.4h-2.7v6.6h-3V6H5.8z" />
  </>
));

export const OiTerminal = icon("terminal", (
  <>
    <rect className="ks" x="1.8" y="3" width="16.4" height="14" rx="2.2" />
    <path className="g thick" d="M5.2 8.6l2.6 2.3-2.6 2.3" />
    <path className="wh thick" d="M9.6 13.4h4.6" />
    <rect className="ol" x="1.8" y="3" width="16.4" height="14" rx="2.2" />
  </>
));

export const OiLayout = icon("layout", (
  <>
    <rect className="of" x="2" y="2" width="7" height="7" rx="1.7" />
    <rect className="of" x="11" y="2" width="7" height="7" rx="1.7" />
    <rect className="of" x="2" y="11" width="7" height="7" rx="1.7" />
    <rect className="bs" x="11" y="11" width="7" height="7" rx="1.7" />
  </>
));

export const OiAssistant = icon("assistant", (
  <>
    <path className="ps" d={SPARKLE(8.8, 10.6, 7.2)} />
    <path className="ns" d={SPARKLE(15.6, 4.2, 2.6)} />
    <path className="bs" d={SPARKLE(16, 15.6, 1.8)} />
  </>
));

export const OiSun = icon("sun", (
  <>
    <circle className="ys" cx="10" cy="10" r="3.4" />
    <path className="o thick half" d="M10 2.2v1.8M10 16v1.8M2.2 10H4M16 10h1.8M14.24 5.76l1.28-1.28M14.24 14.24l1.28 1.28M5.76 14.24l-1.28 1.28M5.76 5.76 4.48 4.48" />
  </>
));

export const OiMoon = icon("moon", (
  <>
    <path className="of" d="M8 2.4a6 6 0 0 0 9.6 9.6 8 8 0 1 1-9.6-9.6z" />
    <path className="ys" d={SPARKLE(15.4, 4.4, 1.9)} />
  </>
));

export const OiMonitor = icon("monitor", (
  <>
    <rect className="bf" x="1.8" y="3" width="16.4" height="11" rx="1.8" />
    <path className="o thick" d="M10 14v3M7 17.2h6" />
  </>
));

export const OiSettings = icon("settings", (
  <>
    <path className="kf" d={GEAR} />
    <circle className="of" cx="10" cy="10" r="2.6" />
  </>
));

export const OiMore = icon("more", (
  <>
    <path className="o ln thick" d="M2.6 5.2h14.8M2.6 10h14.8M2.6 14.8h14.8" />
    <path className="b thick" d="M2.6 5.2h4.6" />
    <path className="g thick" d="M2.6 10h9.2" />
    <path className="n thick" d="M2.6 14.8h6.4" />
    <circle className="of" cx="7.2" cy="5.2" r="2" />
    <circle className="of" cx="11.8" cy="10" r="2" />
    <circle className="of" cx="9" cy="14.8" r="2" />
  </>
));

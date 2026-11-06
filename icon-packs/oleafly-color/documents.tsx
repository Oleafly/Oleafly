import type { ReactNode } from "react";
import { Badge, Cut, FileSheet, FOLD, icon, SHEET, SPARKLE } from "./base";

// Drawn for the app-wide switch to Oleafly Icons: file and folder commands, the clipboard, text
// editing, lists and pictures.

const FOLDER_BACK = "M2 5.2a1.4 1.4 0 0 1 1.4-1.4h3.7l1.6 1.7h7.9a1.4 1.4 0 0 1 1.4 1.4v8.7a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 15.6z";
const FOLDER_FRONT = "M2 8.4a1.2 1.2 0 0 1 1.2-1.2h13.6a1.2 1.2 0 0 1 1.2 1.2v7.2a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 15.6z";

const Folder = () => (
  <>
    <path className="bs" d={FOLDER_BACK} />
    <path className="bf" d={FOLDER_FRONT} />
  </>
);
const Sheet = () => (
  <>
    <path className="of" d={SHEET} />
    <path className="of" d={FOLD} />
    <path className="o ln thick" d="M5.3 6.2h4.2M5.3 8.8h5.4M5.3 11.4h3.4" />
  </>
);
const withBadge = (base: ReactNode, badge: ReactNode) => (
  <>
    <Cut>{base}</Cut>
    {badge}
  </>
);

// White marks for the round corner badge (centre 14.3, 14.3).
const Plus = () => <path className="wh thick" d="M14.3 12.4v3.8M12.4 14.3h3.8" />;
const Minus = () => <path className="wh thick" d="M12.4 14.3h3.8" />;
const Cross = () => <path className="wh thick" d="M12.9 12.9l2.8 2.8M15.7 12.9l-2.8 2.8" />;
const Check = () => <path className="wh thick" d="M12.4 14.5l1.3 1.3 2.5-2.7" />;
const ArrowUp = () => <path className="wh thick" d="M14.3 16.3v-3.6M12.8 14.1l1.5-1.5 1.5 1.5" />;
const ArrowDown = () => <path className="wh thick" d="M14.3 12.3v3.6M12.8 14.5l1.5 1.5 1.5-1.5" />;

/** The clipboard: a wooden board, a sheet of paper and a graphite clip. */
const Clipboard = ({ paper = true }: Readonly<{ paper?: boolean }>) => (
  <>
    <rect className="nf" x="3.2" y="3" width="13.6" height="15.2" rx="1.8" />
    {paper ? (
      <>
        <rect className="of" x="5" y="5.4" width="10" height="11" rx="0.6" />
        <path className="o ln thick" d="M7 8.8h6M7 11.2h6M7 13.6h3.8" />
      </>
    ) : null}
    <rect className="ks" x="6.6" y="1.6" width="6.8" height="3.6" rx="1.1" />
    <path className="gl" d="M7.7 2.8h2.2" />
  </>
);

/** The picture of OiFigure: a blue sky, green hills and a yellow sun. */
const Picture = () => (
  <>
    <rect className="bf" x="2" y="3.4" width="16" height="13.2" rx="1.8" />
    <path className="gs" d="M2 14.2c2.8-3.6 5.8-4.6 8.8-2.6 1.7-1.5 4.3-2 7.2.3v2.9a1.8 1.8 0 0 1-1.8 1.8H3.8A1.8 1.8 0 0 1 2 14.8z" />
    <circle className="ys" cx="6.4" cy="7.6" r="1.7" />
    <rect className="b edge" x="2" y="3.4" width="16" height="13.2" rx="1.8" />
  </>
);

export const OiCopy = icon("copy", (
  <>
    <rect className="bf" x="6.6" y="1.8" width="11.4" height="12.6" rx="1.6" />
    <rect className="of" x="2" y="5.6" width="11.4" height="12.6" rx="1.6" />
    <path className="o ln thick" d="M4.4 9.4h6.6M4.4 12h6.6M4.4 14.6h4.2" />
  </>
));

export const OiFileCheck = icon("file-check", withBadge(<Sheet />, (
  <Badge hue="g">
    <Check />
  </Badge>
)));

export const OiFileDiff = icon("file-diff", (
  <>
    <path className="of" d={SHEET} />
    <path className="of" d={FOLD} />
    <path className="gs" d="M8 4.6h2v2.4h2.4v2H10v2.4H8V9H5.6V7H8z" />
    <rect className="rs" x="5.6" y="13.2" width="6.8" height="2" rx="0.5" />
  </>
));

export const OiFileWarning = icon("file-warning", withBadge(<Sheet />, (
  <Badge hue="n">
    <path className="wh thick" d="M14.3 12.2v2.4" />
    <circle className="wf" cx="14.3" cy="16.3" r="0.55" />
  </Badge>
)));

export const OiFileUpload = icon("file-upload", withBadge(<Sheet />, (
  <Badge hue="b">
    <ArrowUp />
  </Badge>
)));

export const OiFileDownload = icon("file-download", withBadge(<Sheet />, (
  <Badge hue="b">
    <ArrowDown />
  </Badge>
)));

const ARROW_RIGHT = "M0 -1.3h4.6v-2.7l4.6 4-4.6 4v-2.7H0z";

export const OiFileImport = icon("file-import", (
  <>
    <g transform="translate(3.3 0)">
      <path className="of" d={SHEET} />
      <path className="of" d={FOLD} />
      <path className="o ln thick" d="M5.3 6.2h4.2M9.4 16.4h2.6" />
    </g>
    <path className="gs" d={ARROW_RIGHT} transform="translate(1.6 11.6)" />
  </>
));

export const OiFileExport = icon("file-export", (
  <>
    <g transform="translate(-1.2 0)">
      <path className="of" d={SHEET} />
      <path className="of" d={FOLD} />
      <path className="o ln thick" d="M5.3 6.2h4.2M5.3 16.4h3" />
    </g>
    <path className="bs" d={ARROW_RIGHT} transform="translate(9.2 11.6)" />
  </>
));

export const OiFileSearch = icon("file-search", withBadge(<Sheet />, (
  <Badge hue="b">
    <circle className="wh thick" cx="13.8" cy="13.8" r="1.6" />
    <path className="wh thick" d="M15 15l1.4 1.4" />
  </Badge>
)));

export const OiFileLink = icon("file-link", withBadge(<Sheet />, (
  <Badge hue="b">
    <path className="wh thick" d="M12.5 16.4c0-2.2 1.2-3.3 3.6-3.3M14.6 11.8l1.5 1.3-1.5 1.4" />
  </Badge>
)));

export const OiFileRemove = icon("file-remove", withBadge(<Sheet />, (
  <Badge hue="r">
    <Cross />
  </Badge>
)));

export const OiFileFont = icon("file-font", (
  <FileSheet hue="p">
    <path className="wh thick" d="M12.9 13h3.6M14.7 13v3.7M14 16.7h1.4" />
  </FileSheet>
));

export const OiFileSpreadsheet = icon("file-spreadsheet", (
  <FileSheet hue="g">
    <rect className="wf" x="12.5" y="12.5" width="4.4" height="4.4" rx="0.5" />
    <path className="g" d="M12.5 14.7h4.4M14.7 12.5v4.4" />
  </FileSheet>
));

export const OiFiles = icon("files", (
  <>
    <path className="of" d="M7.6 1.8h5.8l3.4 3.4v9.2a1.2 1.2 0 0 1-1.2 1.2h-8a1.2 1.2 0 0 1-1.2-1.2V3a1.2 1.2 0 0 1 1.2-1.2z" />
    <path className="of" d="M13.4 1.8v2.5a.9.9 0 0 0 .9.9h2.5z" />
    <path className="of" d="M3.6 4.6h5.8l3.4 3.4V17a1.2 1.2 0 0 1-1.2 1.2h-8A1.2 1.2 0 0 1 2.4 17V5.8a1.2 1.2 0 0 1 1.2-1.2z" />
    <path className="of" d="M9.4 4.6v2.5a.9.9 0 0 0 .9.9h2.5z" />
    <path className="o ln thick" d="M4.4 10.4h5.4M4.4 12.8h5.4M4.4 15.2h3.4" />
  </>
));

export const OiFolderRemove = icon("folder-remove", withBadge(<Folder />, (
  <Badge hue="r">
    <Cross />
  </Badge>
)));

export const OiFolderDownload = icon("folder-download", withBadge(<Folder />, (
  <Badge hue="g">
    <path className="wh thick" d="M14.3 11.9v3.1M12.9 13.7l1.4 1.4 1.4-1.4M12.6 16.6h3.4" />
  </Badge>
)));

export const OiFolderImport = icon("folder-import", (
  <>
    <path className="bs" d="M5.4 5.2a1.4 1.4 0 0 1 1.4-1.4h3l1.4 1.7h5.8a1.4 1.4 0 0 1 1.4 1.4v8.7a1.4 1.4 0 0 1-1.4 1.4H6.8a1.4 1.4 0 0 1-1.4-1.4z" />
    <path className="bf" d="M5.4 8.4a1.2 1.2 0 0 1 1.2-1.2h10.6a1.2 1.2 0 0 1 1.2 1.2v7.2a1.4 1.4 0 0 1-1.4 1.4H6.8a1.4 1.4 0 0 1-1.4-1.4z" />
    <path className="gs" d={ARROW_RIGHT} transform="translate(1.6 12)" />
  </>
));

export const OiFolderTree = icon("folder-tree", (
  <>
    <path className="k thick" d="M4.6 8.6v6.2h4.6" />
    <g transform="translate(0.5 -0.5) scale(0.55)">
      <Folder />
    </g>
    <g transform="translate(8.5 8.9) scale(0.55)">
      <Folder />
    </g>
  </>
));

export const OiFolderSync = icon("folder-sync", withBadge(<Folder />, (
  <Badge hue="g">
    <path className="wh" d="M12.2 13.9a2.1 2.1 0 0 1 3.7-1.2M16.4 14.7a2.1 2.1 0 0 1-3.7 1.2" />
    <path className="wf" d="M16.5 11.6v1.8h-1.8zM12.1 17v-1.8h1.8z" />
  </Badge>
)));

export const OiFolderMinus = icon("folder-minus", withBadge(<Folder />, (
  <Badge hue="r">
    <Minus />
  </Badge>
)));

export const OiFolderBoard = icon("folder-board", (
  <>
    <Folder />
    <rect className="bs" x="5" y="9.6" width="2.4" height="5.4" rx="0.6" />
    <rect className="bs" x="8.8" y="9.6" width="2.4" height="3.4" rx="0.6" />
    <rect className="bs" x="12.6" y="9.6" width="2.4" height="4.4" rx="0.6" />
  </>
));

const ArchiveBox = () => (
  <>
    <path className="nf" d="M3 7h14v8.6a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 15.6z" />
    <rect className="ns" x="1.8" y="2.8" width="16.4" height="4.4" rx="1.2" />
    <path className="gl" d="M3.2 4.2h5" />
    <rect className="ns" x="7.4" y="9.4" width="5.2" height="1.8" rx="0.9" />
  </>
);

export const OiArchive = icon("archive", <ArchiveBox />);

export const OiArchiveRestore = icon("archive-restore", withBadge(<ArchiveBox />, (
  <Badge hue="b">
    <ArrowUp />
  </Badge>
)));

export const OiPackage = icon("package", (
  <>
    <path className="nf" d="M10 1.8l7.4 4-7.4 4-7.4-4z" />
    <path className="ns" d="M2.6 5.8l7.4 4v8.4l-7.4-4z" />
    <path className="ns half" d="M17.4 5.8v8.4l-7.4 4V9.8z" />
    <path className="wf half" d="M5.6 4.2l7.4 4v8.8l1.8-1V7.2L7.4 3.2z" />
    <path className="ol" d="M10 1.8l7.4 4v8.4l-7.4 4-7.4-4V5.8zM2.6 5.8l7.4 4 7.4-4M10 9.8v8.4" />
  </>
));

export const OiBox = icon("box", (
  <>
    <path className="bf" d="M10 1.8l7.4 4-7.4 4-7.4-4z" />
    <path className="bs" d="M2.6 5.8l7.4 4v8.4l-7.4-4z" />
    <path className="bs half" d="M17.4 5.8v8.4l-7.4 4V9.8z" />
    <path className="gl" d="M3.8 7.6v5.6" />
    <path className="ol" d="M10 1.8l7.4 4v8.4l-7.4 4-7.4-4V5.8zM2.6 5.8l7.4 4 7.4-4M10 9.8v8.4" />
  </>
));

export const OiAttachment = icon("attachment", (
  <path className="k heavy" d="M10 13.4V5.8a2 2 0 0 1 4 0v8.4a4 4 0 0 1-8 0V7.6" transform="rotate(45 10 10.6)" />
));

export const OiClipboardCheck = icon("clipboard-check", withBadge(<Clipboard />, (
  <Badge hue="g">
    <Check />
  </Badge>
)));

export const OiPaste = icon("paste", (
  <>
    <Clipboard paper={false} />
    <path className="of" d="M10.4 8.4h4.6l3.2 3.2v5.4a1.2 1.2 0 0 1-1.2 1.2h-6.6a1.2 1.2 0 0 1-1.2-1.2V9.6a1.2 1.2 0 0 1 1.2-1.2z" />
    <path className="of" d="M15 8.4v2.3a.9.9 0 0 0 .9.9h2.3z" />
    <path className="o ln thick" d="M11 13.4h4.6M11 15.8h3.4" />
  </>
));

export const OiClipboardClock = icon("clipboard-clock", withBadge(<Clipboard />, (
  <Badge hue="n">
    <path className="wh thick" d="M14.3 12.1v2.3l1.6 1" />
  </Badge>
)));

export const OiSave = icon("save", (
  <>
    <path className="bs" d="M3.6 2h10.6L18 5.8v10.6a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 16.4V3.6A1.6 1.6 0 0 1 3.6 2z" />
    <path className="of" d="M5.6 2h7.6v4.2a.8.8 0 0 1-.8.8h-6a.8.8 0 0 1-.8-.8z" />
    <rect className="bs" x="10.2" y="3" width="1.8" height="3" rx="0.4" />
    <path className="of" d="M5.4 10.2h9.2a1 1 0 0 1 1 1V18H4.4v-6.8a1 1 0 0 1 1-1z" />
    <path className="o ln thick" d="M6.6 12.8h6.8M6.6 15.2h5" />
    <path className="gl" d="M3.2 4.6v3.6" />
  </>
));

export const OiUpload = icon("upload", (
  <>
    <path className="kf" d="M2.2 11.4h3.9l1.1 1.8h5.6l1.1-1.8h3.9v4.4a1.6 1.6 0 0 1-1.6 1.6H3.8a1.6 1.6 0 0 1-1.6-1.6z" />
    <path className="bs" d="M10 1.8l4.5 5h-3v5.6h-3V6.8h-3z" />
  </>
));

const RING_LEFT = "M6.2 11.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zm0 1.5a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z";
const RING_RIGHT = "M13.8 11.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zm0 1.5a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z";

export const OiCut = icon("cut", (
  <>
    <path className="ks" d="M6.3 11.3 12.5 1.8h1.2L9.1 12.5z" />
    <path className="ks" d="M13.7 11.3 7.5 1.8H6.3l4.6 10.7z" />
    <circle className="of" cx="10" cy="7.6" r="0.9" />
    <path className="rs" fillRule="evenodd" d={RING_LEFT} />
    <path className="rs" fillRule="evenodd" d={RING_RIGHT} />
    <path className="gl" d="M4.2 13.4a2.2 2.2 0 0 1 1.1-1.1M11.8 13.4a2.2 2.2 0 0 1 1.1-1.1" />
  </>
));

export const OiSplit = icon("split", (
  <>
    <path className="of" d="M4.3 1.8h6.9l3.8 3.8v2.6H3.1V3a1.2 1.2 0 0 1 1.2-1.2z" />
    <path className="of" d={FOLD} />
    <path className="of" d="M3.1 11.8H15V17a1.2 1.2 0 0 1-1.2 1.2H4.3A1.2 1.2 0 0 1 3.1 17z" />
    <path className="o ln thick" d="M5.3 5.4h4.2M5.3 14.8h6.4" />
    <path className="b heavy" d="M2 10h2.6M6.5 10h2.6M11 10h2.6M15.5 10h2.6" />
  </>
));

export const OiReplace = icon("replace", (
  <>
    <rect className="of" x="1.8" y="1.8" width="8.8" height="7" rx="1.6" />
    <path className="o ln thick" d="M4 4.6h4.4M4 6.6h2.8" />
    <rect className="bs" x="8.6" y="10.6" width="9.6" height="7.6" rx="1.8" />
    <path className="gl" d="M9.8 13.2a1.6 1.6 0 0 1 1.3-1.4" />
    <path className="wh thick" d="M11.2 13.6h4.6M11.2 15.8h3" />
    <path className="b thick" d="M12.2 5.2h1.4a2.4 2.4 0 0 1 2.4 2.4v1.6M14.4 7.8l1.6 1.6 1.6-1.6" />
  </>
));

export const OiSelectAll = icon("select-all", (
  <>
    <rect className="bw" x="2.2" y="3.4" width="15.6" height="3.4" rx="0.8" />
    <rect className="bw" x="2.2" y="8.3" width="15.6" height="3.4" rx="0.8" />
    <rect className="bw" x="2.2" y="13.2" width="9.6" height="3.4" rx="0.8" />
    <path className="o thick half" d="M4.2 5.1h11.6M4.2 10h11.6M4.2 14.9h5.6" />
    <path className="b thick" d="M2.2 3.2v3.8M11.8 13v3.8" />
    <circle className="bs" cx="2.2" cy="2.4" r="1.1" />
    <circle className="bs" cx="11.8" cy="17.6" r="1.1" />
  </>
));

export const OiTable = icon("table", (
  <>
    <rect className="of" x="2" y="2.8" width="16" height="14.4" rx="1.8" />
    <path className="bs" d="M3.8 2.8h12.4A1.8 1.8 0 0 1 18 4.6v2.8H2V4.6a1.8 1.8 0 0 1 1.8-1.8z" />
    <path className="gl" d="M3.4 4.6a1.2 1.2 0 0 1 1-1" />
    <path className="wh half" d="M7.4 2.8v4.6M12.6 2.8v4.6" />
    <path className="ol" d="M2 12.3h16M7.4 7.4v9.8M12.6 7.4v9.8" />
    <rect className="ol" x="2" y="2.8" width="16" height="14.4" rx="1.8" />
  </>
));

export const OiChangelog = icon("changelog", (
  <>
    <Cut>
      <path className="of" d={SHEET} />
      <path className="of" d={FOLD} />
      <path className="o ln thick" d="M5.3 6.2h4.2M5.3 8.8h5.4M5.3 11.4h3.4" />
    </Cut>
    <Badge hue="p">
      <path className="wf" d={SPARKLE(14.3, 14.3, 2.8)} />
    </Badge>
  </>
));

const Notebook = () => (
  <>
    <rect className="of" x="4.6" y="1.8" width="12.6" height="16.4" rx="1.6" />
    <path className="ns" d="M6.2 1.8h1.8v16.4H6.2a1.6 1.6 0 0 1-1.6-1.6V3.4a1.6 1.6 0 0 1 1.6-1.6z" />
    <path className="gl" d="M5.6 3.8v4" />
    <path className="k heavy" d="M2.8 5.4h3.2M2.8 10h3.2M2.8 14.6h3.2" />
    <path className="o ln thick" d="M10.2 6h4.6M10.2 8.6h4.6M10.2 11.2h3" />
  </>
);

export const OiNotebook = icon("notebook", <Notebook />);

export const OiNotebookEdit = icon("notebook-edit", withBadge(<Notebook />, (
  <Badge hue="b">
    <path className="wf" d="M15.4 11.9l1.5 1.5-3.8 3.8-2 .5.5-2z" />
  </Badge>
)));

export const OiChecklist = icon("checklist", (
  <>
    <rect className="gs" x="1.8" y="2.2" width="4.6" height="4.6" rx="1.2" />
    <path className="wh thick" d="M3 4.6l1 1 1.6-1.8" />
    <rect className="gs" x="1.8" y="7.7" width="4.6" height="4.6" rx="1.2" />
    <path className="wh thick" d="M3 10.1l1 1 1.6-1.8" />
    <rect className="of" x="1.8" y="13.2" width="4.6" height="4.6" rx="1.2" />
    <path className="o thick half" d="M8.8 4.5h9.4M8.8 10h9.4M8.8 15.5h6.4" />
  </>
));

export const OiOutline = icon("outline", (
  <>
    <path className="ol" d="M3.6 5.4v10.2h3.6M3.6 10h3.6" />
    <rect className="bs" x="1.8" y="2.2" width="3.6" height="3.6" rx="1" />
    <path className="o thick" d="M7.4 4h10.6" />
    <rect className="ns" x="7.6" y="8.4" width="3.2" height="3.2" rx="0.9" />
    <rect className="ns" x="7.6" y="14" width="3.2" height="3.2" rx="0.9" />
    <path className="o thick half" d="M12.6 10h5.4M12.6 15.6h4" />
  </>
));

export const OiTableOfContents = icon("table-of-contents", (
  <>
    <rect className="of" x="2.4" y="1.8" width="15.2" height="16.4" rx="1.8" />
    <rect className="bs" x="4.4" y="4" width="7" height="2.2" rx="0.8" />
    <path className="o ln thick" d="M4.6 9.4h6.4M6.4 12.2h4.6M4.6 15h6.4" />
    <path className="b thick" d="M14 9.4h1.6M14 12.2h1.6M14 15h1.6" />
  </>
));

export const OiImages = icon("images", (
  <>
    <rect className="bf" x="5.2" y="1.8" width="13" height="11.2" rx="1.6" />
    <g transform="translate(0.15 4.3) scale(0.825)">
      <Picture />
    </g>
  </>
));

export const OiImageAdd = icon("image-add", withBadge(<Picture />, (
  <Badge hue="g">
    <Plus />
  </Badge>
)));

export const OiImageOff = icon("image-off", withBadge((
  <>
    <rect className="of" x="2" y="3.4" width="16" height="13.2" rx="1.8" />
    <path className="ks half" d="M2 14.2c2.8-3.6 5.8-4.6 8.8-2.6 1.7-1.5 4.3-2 7.2.3v2.9a1.8 1.8 0 0 1-1.8 1.8H3.8A1.8 1.8 0 0 1 2 14.8z" />
    <circle className="ks half" cx="6.4" cy="7.6" r="1.7" />
    <rect className="ol" x="2" y="3.4" width="16" height="13.2" rx="1.8" />
  </>
), (
  <Badge hue="r">
    <path className="wh thick" d="M12.6 16 16 12.6" />
  </Badge>
)));

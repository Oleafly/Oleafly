import type { ReactNode } from "react";
import { Badge, Cut, FOLD, icon, SHEET } from "./base";

// The file tree: folders, locks, and the commands in its header and context menus.

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
const Plus = () => <path className="wh thick" d="M14.3 12.4v3.8M12.4 14.3h3.8" />;
const Lock = () => (
  <>
    <path className="wh" d="M13.1 14v-.9a1.2 1.2 0 0 1 2.4 0v.9" />
    <rect className="wf" x="12.5" y="13.9" width="3.6" height="2.6" rx="0.5" />
  </>
);
const withBadge = (base: ReactNode, badge: ReactNode) => (
  <>
    <Cut>{base}</Cut>
    {badge}
  </>
);

export const OiFolderOpen = icon("folder-open", (
  <>
    <path className="bs" d={FOLDER_BACK} />
    <path className="bf" d="M5.7 7.8h12.4a.9.9 0 0 1 .85 1.2l-2.4 7a1.4 1.4 0 0 1-1.3.95H3.2a.8.8 0 0 1-.76-1.06l2.3-7.2a1.1 1.1 0 0 1 .96-.89z" />
  </>
));

export const OiFolderLock = icon("folder-lock", withBadge(<Folder />, (
  <Badge hue="n">
    <Lock />
  </Badge>
)));

export const OiFileLock = icon("file-lock", withBadge(<Sheet />, (
  <Badge hue="n">
    <Lock />
  </Badge>
)));

export const OiNewFile = icon("new-file", withBadge(<Sheet />, (
  <Badge hue="g">
    <Plus />
  </Badge>
)));

export const OiNewFolder = icon("new-folder", withBadge(<Folder />, (
  <Badge hue="g">
    <Plus />
  </Badge>
)));

export const OiImport = icon("import", withBadge(<Folder />, (
  <Badge hue="b">
    <path className="wh thick" d="M14.3 12.3v3.6M12.8 14.5l1.5 1.5 1.5-1.5" />
  </Badge>
)));

export const OiDuplicate = icon("duplicate", withBadge((
  <>
    <rect className="of" x="6.6" y="1.8" width="10.4" height="12.4" rx="1.4" />
    <rect className="of" x="3" y="5.4" width="10.4" height="12.8" rx="1.4" />
    <path className="o ln thick" d="M5.2 9h5.6M5.2 11.6h4" />
  </>
), (
  <Badge hue="g">
    <Plus />
  </Badge>
)));

export const OiRename = icon("rename", (
  <g transform="rotate(45 10 10)">
    <rect className="rs" x="8.2" y="1.4" width="3.6" height="2.6" rx="0.9" />
    <rect className="bs" x="8.2" y="3.8" width="3.6" height="9.2" />
    <path className="gl" d="M9.1 5v6.8" />
    <path className="nw" d="M8.2 13h3.6L10 17.6z" />
    <path className="ks" d="M9.35 15.9h1.3L10 17.6z" />
  </g>
));

export const OiDelete = icon("delete", (
  <>
    <path className="kf" d="M5 6.4h10l-.9 10a1.6 1.6 0 0 1-1.6 1.4H7.5a1.6 1.6 0 0 1-1.6-1.4z" />
    <path className="o ln thick" d="M8.2 9v6M11.8 9v6" />
    <path className="k thick" d="M3.4 4.8h13.2M8 4.8V3.6a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.2" />
  </>
));

export const OiOpen = icon("open", withBadge(<Sheet />, (
  <Badge hue="b">
    <path className="wh thick" d="M12.8 15.8l3-3M13.4 12.8h2.4v2.4" />
  </Badge>
)));

export const OiMainDocument = icon("main-document", withBadge(<Sheet />, (
  <Badge hue="y">
    <path className="wf" d="M14.3 11.9l.72 1.46 1.6.23-1.16 1.13.27 1.6-1.43-.75-1.43.75.27-1.6-1.16-1.13 1.6-.23z" />
  </Badge>
)));

const CHAIN = "M8.6 11.4a3 3 0 0 0 4.2.2l2.4-2.4a3 3 0 0 0-4.2-4.2l-1 1M11.4 8.6a3 3 0 0 0-4.2-.2l-2.4 2.4a3 3 0 0 0 4.2 4.2l1-1";

export const OiInsertLink = icon("insert-link", <path className="b heavy" d={CHAIN} />);

export const OiCopyLink = icon("copy-link", withBadge((
  <>
    <rect className="of" x="2.4" y="2.4" width="11.6" height="11.6" rx="1.8" />
    <path className="b thick" d="M6.4 8.8a2 2 0 0 0 2.8.1l1.6-1.6a2 2 0 0 0-2.8-2.8l-.6.6M8.6 7.2a2 2 0 0 0-2.8-.1L4.2 8.7a2 2 0 0 0 2.8 2.8l.6-.6" />
  </>
), (
  <Badge hue="g">
    <rect className="wf" x="12.6" y="12.9" width="2.6" height="3" rx="0.5" />
    <path className="wh" d="M14.1 12.3h1.6a.6.6 0 0 1 .6.6v2.2" />
  </Badge>
)));

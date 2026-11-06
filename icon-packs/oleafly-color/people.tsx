import type { ReactNode } from "react";
import { Badge, Cut, icon } from "./base";

// People, messages, mail, the cloud and the server, places, and the community links.

const withBadge = (base: ReactNode, badge: ReactNode) => (
  <>
    <Cut>{base}</Cut>
    {badge}
  </>
);

// Badge marks, centred on the badge at (14.3, 14.3).
const Plus = () => <path className="wh thick" d="M14.3 12.4v3.8M12.4 14.3h3.8" />;
const Minus = () => <path className="wh thick" d="M12.4 14.3h3.8" />;
const Cross = () => <path className="wh thick" d="M12.9 12.9l2.8 2.8M15.7 12.9l-2.8 2.8" />;
const Check = () => <path className="wh thick" d="M12.6 14.4l1.2 1.2 2.4-2.5" />;
const Up = () => <path className="wh thick" d="M14.3 16.2v-3.6M12.8 14.1l1.5-1.5 1.5 1.5" />;
const Down = () => <path className="wh thick" d="M14.3 12.3v3.6M12.8 14.5l1.5 1.5 1.5-1.5" />;
const Alert = () => (
  <>
    <path className="wh thick" d="M14.3 12.1v2.5" />
    <circle className="wf" cx="14.3" cy="16.3" r="0.5" />
  </>
);
const Lock = () => (
  <>
    <path className="wh" d="M13.1 14v-.9a1.2 1.2 0 0 1 2.4 0v.9" />
    <rect className="wf" x="12.5" y="13.9" width="3.6" height="2.6" rx="0.5" />
  </>
);
const Cog = () => (
  <path
    className="wf"
    fillRule="evenodd"
    d="M13.63 12.15L13.62 11.27L14.98 11.27L14.97 12.15L15.82 12.64L16.58 12.2L17.26 13.37L16.5 13.81L16.5 14.79L17.26 15.23L16.58 16.4L15.82 15.96L14.97 16.45L14.98 17.33L13.62 17.33L13.63 16.45L12.78 15.96L12.02 16.4L11.34 15.23L12.1 14.79L12.1 13.81L11.34 13.37L12.02 12.2L12.78 12.64zM14.3 13.3a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
  />
);
const Refresh = () => (
  <>
    <path className="wh thick" d="M15.71 15.99A2.2 2.2 0 1 1 14.87 12.17" />
    <path className="wf" d="M15.15 11.11l1.14 2.26-1.71-.13z" />
  </>
);

/** A red bar across an object that is switched off. */
const Slash = () => <path className="rs" d="M3.8 2.5L17.5 16.2a.9.9 0 0 1-1.3 1.3L2.5 3.8a.9.9 0 0 1 1.3-1.3z" />;

// People

export const OiUser = icon("user", (
  <>
    <circle className="bs" cx="10" cy="6" r="3.6" />
    <path className="bs" d="M3.4 17.8a6.6 6.6 0 0 1 13.2 0v.4H3.4z" />
    <path className="gl" d="M7.8 5.3a2.4 2.4 0 0 1 1.5-1.6" />
  </>
));

const Person = () => (
  <>
    <circle className="bs" cx="7.6" cy="6.4" r="3.3" />
    <path className="bs" d="M1.6 17.6a6 6 0 0 1 12 0v.6H1.6z" />
    <path className="gl" d="M5.6 5.8a2.2 2.2 0 0 1 1.4-1.5" />
  </>
);

export const OiUserAdd = icon("user-add", withBadge(<Person />, <Badge hue="g"><Plus /></Badge>));
export const OiUserRemove = icon("user-remove", withBadge(<Person />, <Badge hue="r"><Minus /></Badge>));
export const OiUserBlocked = icon("user-blocked", withBadge(<Person />, <Badge hue="r"><Cross /></Badge>));
export const OiUserCheck = icon("user-check", withBadge(<Person />, <Badge hue="g"><Check /></Badge>));
export const OiUserSettings = icon("user-settings", withBadge(<Person />, <Badge hue="k"><Cog /></Badge>));
export const OiUserLock = icon("user-lock", withBadge(<Person />, <Badge hue="n"><Lock /></Badge>));

export const OiMention = icon("mention", (
  <>
    <circle className="bw" cx="10" cy="10" r="8" />
    <circle className="b heavy" cx="10" cy="10" r="2.9" />
    <path className="b heavy" d="M12.9 7v4.2a2.2 2.2 0 0 0 4.4 0V10a7.3 7.3 0 1 0-2.9 5.8" />
  </>
));

// Mail and phone

const Envelope = () => (
  <>
    <rect className="bf" x="1.8" y="4" width="16.4" height="12" rx="1.8" />
    <path className="b half" d="M2.5 15.3l5.6-5.2M17.5 15.3l-5.6-5.2" />
    <path className="bs" d="M2.3 4.9A1.8 1.8 0 0 1 3.6 4h12.8a1.8 1.8 0 0 1 1.3.9L10 11.2z" />
    <path className="gl" d="M4.6 5.4l2.4 2" />
  </>
);

export const OiMail = icon("mail", <Envelope />);
export const OiMailOff = icon("mail-off", withBadge(<Envelope />, <Badge hue="r"><Cross /></Badge>));

export const OiSend = icon("send", (
  <>
    <path className="bs" d="M18 2 2 8.6l6.6 2.8z" />
    <path className="bf" d="M18 2 8.6 11.4l2.8 6.6z" />
    <path className="gl" d="M5.2 8.2l5.4-2.3" />
  </>
));

export const OiPhone = icon("phone", (
  <>
    <path className="gs" d="M5.6 2.4c.5 0 .9.3 1.1.8l1.2 2.9c.2.5.1 1-.3 1.4L6.2 8.9c1 2.1 2.8 3.9 4.9 4.9l1.4-1.4c.4-.4.9-.5 1.4-.3l2.9 1.2c.5.2.8.6.8 1.1v2.3c0 .8-.6 1.5-1.4 1.5C9 18 2 11 2 3.8c0-.8.7-1.4 1.5-1.4z" />
    <path className="gl" d="M3.4 4.2a1 1 0 0 1 .8-.8" />
  </>
));

// Messages

const BUBBLE = "M4.2 2.6h11.6a1.8 1.8 0 0 1 1.8 1.8v8.2a1.8 1.8 0 0 1-1.8 1.8H9.6l-3.6 3.2v-3.2H4.2a1.8 1.8 0 0 1-1.8-1.8V4.4a1.8 1.8 0 0 1 1.8-1.8z";

export const OiAddComment = icon("add-comment", (
  <>
    <path className="bs" d={BUBBLE} />
    <path className="gl" d="M4.4 6.4a2 2 0 0 1 1.6-1.8" />
    <path className="wh thick" d="M10 5.4v6M7 8.4h6" />
  </>
));

export const OiMessage = icon("message", (
  <>
    <path className="bf" d={BUBBLE} />
    <path className="b thick" d="M5.6 6.4h8.8M5.6 9.4h6" />
  </>
));

export const OiQuoteMessage = icon("quote-message", (
  <>
    <path className="bf" d={BUBBLE} />
    <path className="bs" d="M5.5 7.2a1.9 1.9 0 1 1 3.8 0c0 2.2-1.2 3.7-3.3 4.4l-.4-.9c1-.5 1.6-1.1 1.8-1.7a1.9 1.9 0 0 1-1.9-1.8zM10.7 7.2a1.9 1.9 0 1 1 3.8 0c0 2.2-1.2 3.7-3.3 4.4l-.4-.9c1-.5 1.6-1.1 1.8-1.7a1.9 1.9 0 0 1-1.9-1.8z" />
  </>
));

export const OiReply = icon("reply", (
  <>
    <path className="bs" d={BUBBLE} />
    <path className="gl" d="M4.4 6.4a2 2 0 0 1 1.6-1.8" />
    <path className="wh thick" d="M8.6 5.4 5.8 8.2l2.8 2.8M6 8.2h5.4A2.6 2.6 0 0 1 14 10.8v1" />
  </>
));

export const OiShareMessage = icon("share-message", withBadge((
  <>
    <path className="bf" d={BUBBLE} />
    <path className="b thick" d="M5.6 6.4h8.8M5.6 9.4h4" />
  </>
), (
  <Badge hue="b">
    <path className="wh thick" d="M12.6 16l3.2-3.2M13.4 12.6h2.6v2.6" />
  </Badge>
)));

export const OiSuggestion = icon("suggestion", (
  <>
    <path className="of" d={BUBBLE} />
    <path className="g heavy" d="M10 4.8v4.4M7.8 7h4.4" />
    <path className="r heavy" d="M7.8 11.2h4.4" />
  </>
));

export const OiCommentsOff = icon("comments-off", (
  <>
    <path className="kf" d={BUBBLE} />
    <path className="o ln thick" d="M5.6 6.4h8.8M5.6 9.4h6" />
    <Slash />
  </>
));

// Cloud sync

const CLOUD = "M5.6 16a3.8 3.8 0 0 1-.2-7.6 5 5 0 0 1 10 .1 3.8 3.8 0 0 1-.8 7.5z";
const Cloud = () => (
  <>
    <path className="bs" d={CLOUD} />
    <path className="gl" d="M7.6 7.6a3 3 0 0 1 2.4-2" />
  </>
);

export const OiCloud = icon("cloud", <Cloud />);
export const OiCloudOff = icon("cloud-off", (
  <>
    <path className="kf" d={CLOUD} />
    <Slash />
  </>
));
export const OiCloudUpload = icon("cloud-upload", withBadge(<Cloud />, <Badge hue="b"><Up /></Badge>));
export const OiCloudDownload = icon("cloud-download", withBadge(<Cloud />, <Badge hue="b"><Down /></Badge>));
export const OiCloudCheck = icon("cloud-check", withBadge(<Cloud />, <Badge hue="g"><Check /></Badge>));
export const OiCloudAlert = icon("cloud-alert", withBadge(<Cloud />, <Badge hue="n"><Alert /></Badge>));

// The web and places

export const OiGlobe = icon("globe", (
  <>
    <circle className="bs" cx="10" cy="10" r="7.8" />
    <path className="wh" d="M2.2 10h15.6M3.3 6h13.4M3.3 14h13.4" />
    <ellipse className="wh" cx="10" cy="10" rx="3.2" ry="7.8" />
    <path className="gl" d="M4.4 6.4a6.4 6.4 0 0 1 2.4-2.6" />
  </>
));

export const OiPin = icon("pin", (
  <>
    <path className="rs" d="M10 18.2c-3.6-3.9-6-7-6-10.2a6 6 0 0 1 12 0c0 3.2-2.4 6.3-6 10.2z" />
    <circle className="wf" cx="10" cy="8" r="2.2" />
    <path className="gl" d="M5.6 6.4a4.6 4.6 0 0 1 2-2.4" />
  </>
));

export const OiMap = icon("map", (
  <>
    <path className="gf" d="M1.8 4.6l5.4-2v12.8l-5.4 2z" />
    <path className="gs" d="M7.2 2.6l5.6 2v12.8l-5.6-2z" />
    <path className="gf" d="M12.8 4.6l5.4-2v12.8l-5.4 2z" />
    <path className="r thick" d="M3.8 13.4C6.2 9.4 8.6 13.8 10.8 11.2S14.6 6.6 16.4 8.2" />
  </>
));

// The collaboration server, disks and data

const Server = ({ hue = "k" }: Readonly<{ hue?: "k" | "kf" }>) => {
  const box = hue === "k" ? "ks" : "kf";
  return (
    <>
      <rect className={box} x="2.4" y="2.4" width="15.2" height="6.8" rx="1.6" />
      <rect className={box} x="2.4" y="10.8" width="15.2" height="6.8" rx="1.6" />
      <circle className="gs" cx="5.6" cy="5.8" r="1" />
      <circle className="gs" cx="5.6" cy="14.2" r="1" />
      <path className={hue === "k" ? "wh half" : "o ln thick"} d="M9 5.8h5.8M9 14.2h5.8" />
    </>
  );
};

export const OiServer = icon("server", <Server />);
export const OiServerSettings = icon("server-settings", withBadge(<Server />, <Badge hue="b"><Cog /></Badge>));
export const OiServerOff = icon("server-off", (
  <>
    <Server hue="kf" />
    <Slash />
  </>
));

const Drive = () => (
  <>
    <path className="kf" d="M4.4 4.4h11.2l2.6 6v4a1.8 1.8 0 0 1-1.8 1.8H3.6a1.8 1.8 0 0 1-1.8-1.8v-4z" />
    <path className="ks" d="M1.8 10.4h16.4v4a1.8 1.8 0 0 1-1.8 1.8H3.6a1.8 1.8 0 0 1-1.8-1.8z" />
    <circle className="gs" cx="14.8" cy="13.3" r="1" />
    <path className="wh half" d="M4.4 13.3h5.6" />
  </>
);

export const OiDrive = icon("drive", <Drive />);
export const OiDriveUpload = icon("drive-upload", withBadge(<Drive />, <Badge hue="b"><Up /></Badge>));

export const OiDatabaseSync = icon("database-sync", withBadge((
  <>
    <path className="bs" d="M3.6 4.4v11.2c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4V4.4c0 1.3-2.9 2.4-6.4 2.4S3.6 5.7 3.6 4.4z" />
    <ellipse className="bf" cx="10" cy="4.4" rx="6.4" ry="2.4" />
    <path className="wh half" d="M3.6 8.2c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4M3.6 11.9c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4" />
  </>
), (
  <Badge hue="g">
    <Refresh />
  </Badge>
)));

export const OiBroadcast = icon("broadcast", (
  <>
    <path className="r thick half" d="M3.9 3.9a8.6 8.6 0 0 0 0 12.2M16.1 3.9a8.6 8.6 0 0 1 0 12.2" />
    <path className="r thick" d="M6.5 6.5a5 5 0 0 0 0 7M13.5 6.5a5 5 0 0 1 0 7" />
    <circle className="rs" cx="10" cy="10" r="2.4" />
  </>
));

// Organisations and places

export const OiOrganization = icon("organization", (
  <>
    <rect className="of" x="12" y="7.4" width="5.6" height="10.8" rx="1" />
    <rect className="bs" x="2.4" y="1.8" width="10.2" height="16.4" rx="1.2" />
    <path className="wf half" d="M4.8 4.6h1.8v1.8H4.8zM8.4 4.6h1.8v1.8H8.4zM4.8 8.4h1.8v1.8H4.8zM8.4 8.4h1.8v1.8H8.4zM4.8 12.2h1.8V14H4.8zM8.4 12.2h1.8V14H8.4z" />
    <path className="o ln thick" d="M14 10.4h1.6M14 13h1.6M14 15.6h1.6" />
  </>
));

export const OiInstitution = icon("institution", (
  <>
    <path className="bs" d="M10 1.8l8 4.2v1.6H2V6z" />
    <path className="of" d="M3.6 8.6h2v6.4h-2zM7.2 8.6h2v6.4h-2zM10.8 8.6h2v6.4h-2zM14.4 8.6h2v6.4h-2z" />
    <rect className="bs" x="2" y="15.6" width="16" height="2.6" rx="0.6" />
    <path className="gl" d="M6 5.4l3.4-1.8" />
  </>
));

export const OiHome = icon("home", (
  <>
    <path className="of" d="M4.4 9.4 10 4.6l5.6 4.8v7.2a1.4 1.4 0 0 1-1.4 1.4H5.8a1.4 1.4 0 0 1-1.4-1.4z" />
    <rect className="ns" x="8.3" y="11.8" width="3.4" height="6.2" rx="0.8" />
    <path className="bs" d="M10 2.2l8.3 7.2a1 1 0 0 1-1.3 1.5L10 4.9l-7 6a1 1 0 0 1-1.3-1.5z" />
  </>
));

export const OiSupport = icon("support", (
  <>
    <path className="rs" d="M10.6 10.4C8.6 8.8 6.6 7.4 6.6 5.4a2.2 2.2 0 0 1 4-1.3 2.2 2.2 0 0 1 4 1.3c0 2-2 3.4-4 5z" />
    <path className="nf" d="M3.6 11.4h3.2c1 0 1.9.4 2.5 1h2.9a1.3 1.3 0 0 1 1.2.8l3-2.4a1.3 1.3 0 0 1 1.7 2l-3.8 3.6a3 3 0 0 1-2.1.9H3.6z" />
    <path className="n thick" d="M9 14.8h3.6" />
    <rect className="ks" x="1.6" y="10.6" width="2.4" height="7.4" rx="0.6" />
    <path className="gl" d="M7.8 4.6a1.2 1.2 0 0 1 1-.8" />
  </>
));

// Community links (Help & About)

export const OiGithub = icon("github", (
  <g transform="translate(2 2) scale(0.6667)">
    <path className="ink" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </g>
));

export const OiDiscord = icon("discord", (
  <g transform="translate(2 2) scale(0.6667)">
    <path className="brand-discord" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
  </g>
));

export const OiX = icon("x", (
  <g transform="translate(2.6 2.6) scale(0.6167)">
    <path className="ink" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </g>
));

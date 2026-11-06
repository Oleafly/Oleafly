import { Badge, Cut, icon } from "./base";

// Drawn for the app-wide switch to Oleafly Icons.

// Security: locks, keys and the sandbox / trust shields (the same shield as OiPreflight).

const SHIELD = "M10 2.2l6.4 2.4v4.6c0 4.2-2.7 7.3-6.4 8.6-3.7-1.3-6.4-4.4-6.4-8.6V4.6z";
const SHIELD_SHINE = "M5.3 5.7 8.7 4.4";

export const OiLock = icon("lock", (
  <>
    <path className="ks" d="M5.8 9V6.4a4.2 4.2 0 0 1 8.4 0V9h-1.7V6.4a2.5 2.5 0 0 0-5 0V9z" />
    <rect className="ns" x="3.4" y="8.4" width="13.2" height="9.8" rx="2.2" />
    <path className="gl" d="M5 10.8a1.6 1.6 0 0 1 1.3-1.1" />
    <path className="wf" d="M10 11.1a1.3 1.3 0 0 1 .7 2.4l.4 2.1H8.9l.4-2.1a1.3 1.3 0 0 1 .7-2.4z" />
  </>
));

export const OiKey = icon("key", (
  <g transform="rotate(45 10 10)">
    <path
      className="ys"
      fillRule="evenodd"
      d="M8.64 8.9H18.4v2.2h-.6v2.1h-1.6v-2.1h-.8v1.5h-1.6v-1.5H8.64A3.8 3.8 0 1 1 8.64 8.9zM4.4 8.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"
    />
    <path className="gl" d="M2.6 9.2a2.6 2.6 0 0 1 1.4-1.6" />
  </g>
));

export const OiShield = icon("shield", (
  <>
    <path className="bs" d={SHIELD} />
    <path className="wh half" d="M10 4.4l4.4 1.6v3.3c0 3-1.8 5.3-4.4 6.4-2.6-1.1-4.4-3.4-4.4-6.4V6z" />
    <path className="gl" d={SHIELD_SHINE} />
  </>
));

export const OiShieldAlert = icon("shield-alert", (
  <>
    <path className="ns" d={SHIELD} />
    <path className="gl" d={SHIELD_SHINE} />
    <rect className="wf" x="9.15" y="5.8" width="1.7" height="5.6" rx="0.85" />
    <circle className="wf" cx="10" cy="13.7" r="1" />
  </>
));

export const OiShieldQuestion = icon("shield-question", (
  <>
    <path className="bs" d={SHIELD} />
    <path className="gl" d={SHIELD_SHINE} />
    <path className="wh thick" d="M7.9 7.9a2.1 2.1 0 1 1 3 1.9c-.6.3-.9.8-.9 1.4v.4" />
    <circle className="wf" cx="10" cy="13.9" r="0.9" />
  </>
));

export const OiShieldOff = icon("shield-off", (
  <>
    <path className="rs" d={SHIELD} />
    <path className="gl" d={SHIELD_SHINE} />
    <path className="wh thick" d="M7.6 7.4l4.8 4.8M12.4 7.4l-4.8 4.8" />
  </>
));

// Accounts and sessions: a door with an arrow going in or out, and an open door to leave.

export const OiSignIn = icon("sign-in", (
  <>
    <rect className="kf" x="10.6" y="2.2" width="7.2" height="15.6" rx="1.6" />
    <path className="gs" d="M1.8 8.6h6.6V5.4l5 4.6-5 4.6v-3.2H1.8z" />
  </>
));

export const OiSignOut = icon("sign-out", (
  <>
    <rect className="kf" x="2.2" y="2.2" width="7.2" height="15.6" rx="1.6" />
    <path className="rs" d="M6.4 8.6h6.6V5.4l5 4.6-5 4.6v-3.2H6.4z" />
  </>
));

export const OiLeave = icon("leave", (
  <>
    <path className="bf" d="M7.4 2.2h8.6a1.4 1.4 0 0 1 1.4 1.4v14.2H7.4z" />
    <path className="ns" d="M7.4 2.2v15.6l-4.8-1.2V3.6z" />
    <path className="gl" d="M3.8 5.2v3" />
    <circle className="wf" cx="4.4" cy="10.6" r="0.75" />
  </>
));

// Little objects: bug reports, quick actions, trending, favourites and the playful empty states.

export const OiBug = icon("bug", (
  <>
    <path className="o thick" d="M8.6 3.2 7.2 1.8M11.4 3.2l1.4-1.4M4.8 9.4 2.4 8.2M4.4 12.4H2M4.9 15.2l-2.3 1.4M15.2 9.4l2.4-1.2M15.6 12.4H18M15.1 15.2l2.3 1.4" />
    <circle className="ks" cx="10" cy="5.4" r="2.6" />
    <ellipse className="rs" cx="10" cy="12" rx="5.6" ry="5.8" />
    <path className="wh" d="M10 6.6v11" />
    <circle className="ks" cx="7.6" cy="10.2" r="1" />
    <circle className="ks" cx="12.4" cy="10.2" r="1" />
    <circle className="ks" cx="7.9" cy="14.2" r="0.9" />
    <circle className="ks" cx="12.1" cy="14.2" r="0.9" />
    <path className="gl" d="M5.6 10a4.6 4.6 0 0 1 1.6-2.6" />
  </>
));

export const OiZap = icon("zap", (
  <>
    <path className="ys" d="M11.8 1.8 4.2 11h5.2l-1.2 7.2 7.6-9.4h-5.2z" />
    <path className="gl" d="M10 4.6 6.6 8.8" />
  </>
));

export const OiFlame = icon("flame", (
  <>
    <path className="ns" d="M10.6 1.8c.4 3.2 5.5 5.4 5.5 10.4a6.1 6.1 0 0 1-12.2 0c0-2.6 1.2-4.2 2.6-5.6.2 1.6.8 2.6 1.8 3-.4-3 .6-6 2.3-7.8z" />
    <path className="ys" d="M10.2 9.6c.4 2 3 3 3 5.2a3 3 0 0 1-6 0c0-1.4.6-2.2 1.4-3 .2.8.6 1.2 1.2 1.4-.2-1.4.1-2.6.4-3.6z" />
  </>
));

export const OiStar = icon("star", (
  <>
    <path className="ys" d="M10 2.2l2.12 5.49 5.87.31-4.57 3.71 1.52 5.69L10 14.2l-4.94 3.2 1.52-5.69L2.01 8l5.87-.31z" />
    <path className="gl" d="M6.4 9.4 8.2 8.2" />
  </>
));

export const OiEgg = icon("egg", (
  <>
    <path className="nf" d="M10 1.8c3.6 0 6.2 5.8 6.2 10 0 3.8-2.6 6.4-6.2 6.4s-6.2-2.6-6.2-6.4c0-4.2 2.6-10 6.2-10z" />
    <path className="gl" d="M6.2 9.2a5.6 5.6 0 0 1 1.6-3.4" />
    <path className="n thick" d="M4.4 11.4l1.8 1.4 1.6-1.6 1.6 1.6 1.6-1.6 1.6 1.6 1.6-1.6 1.6 1.2" />
  </>
));

export const OiGhost = icon("ghost", (
  <>
    <path className="of" d="M3.8 9.4a6.2 6.2 0 0 1 12.4 0v8.2l-2.07-1.4-2.06 1.4L10 16.2l-2.07 1.4-2.06-1.4-2.07 1.4z" />
    <circle className="rw" cx="6.4" cy="11.8" r="0.9" />
    <circle className="rw" cx="13.6" cy="11.8" r="0.9" />
    <path className="o heavy" d="M7.9 8.6v1.2M12.1 8.6v1.2" />
  </>
));

// Hardware and accessibility, drawn like OiMonitor.

export const OiLaptop = icon("laptop", (
  <>
    <rect className="bf" x="3.2" y="3.4" width="13.6" height="10" rx="1.4" />
    <path className="kf" d="M1.6 13.8h16.8v.9a1.9 1.9 0 0 1-1.9 1.9H3.5a1.9 1.9 0 0 1-1.9-1.9z" />
    <path className="ol" d="M8.4 13.8c0 .5.4.8.9.8h1.4c.5 0 .9-.3.9-.8" />
  </>
));

export const OiDevices = icon("devices", (
  <>
    <rect className="bf" x="1.8" y="3" width="12.6" height="9.4" rx="1.6" />
    <path className="o thick" d="M7.4 12.4v3.2M4.8 15.8h5.2" />
    <rect className="ks" x="12.2" y="6.2" width="6" height="11.6" rx="1.4" />
    <rect className="bw" x="13.1" y="7.6" width="4.2" height="8.2" rx="0.5" />
  </>
));

export const OiContrast = icon("contrast", (
  <>
    <circle className="wf" cx="10" cy="10" r="7.8" />
    <path className="ks" d="M10 2.2a7.8 7.8 0 0 1 0 15.6z" />
    <circle className="o" cx="10" cy="10" r="7.8" />
  </>
));

export const OiAccessibility = icon("accessibility", (
  <>
    <circle className="bs" cx="10" cy="10" r="8.2" />
    <path className="gl" d="M4.2 8a6 6 0 0 1 2.6-3.6" />
    <circle className="wf" cx="10" cy="5.4" r="1.5" />
    <path className="wh thick" d="M5.2 8.2c3.2.9 6.4.9 9.6 0M10 9v3.4M10 12.4l-2.2 4M10 12.4l2.2 4" />
  </>
));

export const OiTools = icon("tools", (
  <>
    <path className="ks" d="M6.8 7.4V4.8a1.4 1.4 0 0 1 1.4-1.4h3.6a1.4 1.4 0 0 1 1.4 1.4v2.6h-1.6V5h-3.2v2.4z" />
    <rect className="rs" x="1.8" y="6.8" width="16.4" height="11" rx="1.8" />
    <path className="gl" d="M3.6 9.6a1.6 1.6 0 0 1 1.2-1.2" />
    <path className="wh half" d="M1.8 11.4h16.4" />
    <rect className="wf" x="8.6" y="10.2" width="2.8" height="2.4" rx="0.6" />
  </>
));

// Calendars: a paper page under a red header strip.

const Calendar = () => (
  <>
    <rect className="of" x="2.2" y="3.4" width="15.6" height="14.6" rx="1.8" />
    <path className="rs" d="M4 3.4h12a1.8 1.8 0 0 1 1.8 1.8V8H2.2V5.2A1.8 1.8 0 0 1 4 3.4z" />
    <rect className="ks" x="5.4" y="1.6" width="1.6" height="3.6" rx="0.8" />
    <rect className="ks" x="13" y="1.6" width="1.6" height="3.6" rx="0.8" />
    <path className="o half thick" d="M5.4 11.2h.8M9.6 11.2h.8M13.8 11.2h.8M5.4 14.8h.8M9.6 14.8h.8M13.8 14.8h.8" />
  </>
);

export const OiCalendar = icon("calendar", <Calendar />);

export const OiSchedule = icon("schedule", (
  <>
    <Cut>
      <Calendar />
    </Cut>
    <Badge hue="b">
      <path className="wh thick" d="M14.3 12.2v2.2l1.5 1" />
    </Badge>
  </>
));

export const OiCalendarAdd = icon("calendar-add", (
  <>
    <Cut>
      <Calendar />
    </Cut>
    <Badge hue="g">
      <path className="wh thick" d="M14.3 12.4v3.8M12.4 14.3h3.8" />
    </Badge>
  </>
));

export const OiCalendarRemove = icon("calendar-remove", (
  <>
    <Cut>
      <Calendar />
    </Cut>
    <Badge hue="r">
      <path className="wh thick" d="M12.9 12.9l2.8 2.8M15.7 12.9l-2.8 2.8" />
    </Badge>
  </>
));

export const OiClock = icon("clock", (
  <>
    <circle className="of" cx="10" cy="10" r="8.2" />
    <path className="o ln thick" d="M10 3.6v1M16.4 10h-1M10 16.4v-1M3.6 10h1" />
    <path className="o thick" d="M10 5.8V10l3 2" />
    <circle className="ns" cx="10" cy="10" r="1" />
  </>
));

export const OiWallet = icon("wallet", (
  <>
    <rect className="gs" x="5.4" y="2.2" width="11" height="6" rx="1" />
    <rect className="bs" x="3.6" y="3.8" width="11.6" height="6" rx="1" />
    <rect className="ns" x="1.8" y="6.6" width="16.4" height="11.2" rx="2" />
    <path className="gl" d="M3.6 9.4a1.6 1.6 0 0 1 1.4-1.2" />
    <path className="nf" d="M18.2 10h-4.6a2.2 2.2 0 0 0 0 4.4h4.6z" />
    <circle className="ns" cx="13.8" cy="12.2" r="0.9" />
  </>
));

// Git, in the node-and-line style of OiSourceControl and OiFork. Compare uses the diff colours.

export const OiMerge = icon("merge", (
  <>
    <path className="o thick" d="M6 7v10.8M6 7.6a6 6 0 0 0 6 6" />
    <circle className="gs" cx="6" cy="4.6" r="2.4" />
    <circle className="ps" cx="14.2" cy="13.6" r="2.4" />
    <path className="gl" d="M4.7 4a1.5 1.5 0 0 1 .9-.9M12.9 13a1.5 1.5 0 0 1 .9-.9" />
  </>
));

export const OiCommit = icon("commit", (
  <>
    <path className="o thick" d="M1.8 10h4.4M13.8 10h4.4" />
    <circle className="gs" cx="10" cy="10" r="4" />
    <path className="gl" d="M7.6 9.2a2.6 2.6 0 0 1 1.6-1.6" />
  </>
));

export const OiCompare = icon("compare", (
  <>
    <path className="o thick" d="M11 5h2.4A1.6 1.6 0 0 1 15 6.6v6M12.8 3.2 11 5l1.8 1.8M9 15H6.6A1.6 1.6 0 0 1 5 13.4v-6M7.2 13.2 9 15l-1.8 1.8" />
    <circle className="rs" cx="5" cy="5" r="2.4" />
    <circle className="gs" cx="15" cy="15" r="2.4" />
    <path className="gl" d="M3.7 4.4a1.5 1.5 0 0 1 .9-.9M13.7 14.4a1.5 1.5 0 0 1 .9-.9" />
  </>
));

export const OiPullRequest = icon("pull-request", (
  <>
    <path className="o thick" d="M5 7v6M15 13V6.6A1.6 1.6 0 0 0 13.4 5h-2.8M12.4 3.2 10.6 5l1.8 1.8" />
    <circle className="gs" cx="5" cy="4.6" r="2.4" />
    <circle className="gs" cx="5" cy="15.4" r="2.4" />
    <circle className="ps" cx="15" cy="15.4" r="2.4" />
    <path className="gl" d="M3.7 4a1.5 1.5 0 0 1 .9-.9M3.7 14.8a1.5 1.5 0 0 1 .9-.9M13.7 14.8a1.5 1.5 0 0 1 .9-.9" />
  </>
));

// The figure editor: arrange layers, and page orientation.

export const OiBringToFront = icon("bring-to-front", (
  <>
    <rect className="of" x="7.4" y="7.4" width="10.8" height="10.8" rx="1.8" />
    <rect className="bs" x="1.8" y="1.8" width="10.8" height="10.8" rx="1.8" />
    <path className="gl" d="M3.6 5.2a1.8 1.8 0 0 1 1.6-1.6" />
  </>
));

export const OiSendToBack = icon("send-to-back", (
  <>
    <rect className="bs" x="1.8" y="1.8" width="10.8" height="10.8" rx="1.8" />
    <path className="gl" d="M3.6 5.2a1.8 1.8 0 0 1 1.6-1.6" />
    <rect className="of" x="7.4" y="7.4" width="10.8" height="10.8" rx="1.8" />
  </>
));

export const OiPortrait = icon("portrait", (
  <>
    <rect className="of" x="4.2" y="1.8" width="11.6" height="16.4" rx="1.6" />
    <path className="b thick" d="M6.4 5.2h4.4" />
    <path className="o ln thick" d="M6.4 8h7.2M6.4 10.6h7.2M6.4 13.2h7.2M6.4 15.8h4.4" />
  </>
));

export const OiLandscape = icon("landscape", (
  <>
    <rect className="of" x="1.8" y="4.2" width="16.4" height="11.6" rx="1.6" />
    <path className="b thick" d="M4.2 7.4h5" />
    <path className="o ln thick" d="M4.2 10h11.6M4.2 12.8h8" />
  </>
));

// Disconnect: OiPlug with a red remove badge.

export const OiDisconnect = icon("disconnect", (
  <>
    <Cut>
      <path className="k heavy" d="M5.8 2.4v4M10.2 2.4v4" />
      <path className="bs" d="M3.2 6.4h9.6v3.2a4.8 4.8 0 0 1-9.6 0z" />
      <path className="gl" d="M4.6 8.2v1.4" />
      <path className="k heavy" d="M8 14.4v3.4" />
    </Cut>
    <Badge hue="r">
      <path className="wh thick" d="M12.9 12.9l2.8 2.8M15.7 12.9l-2.8 2.8" />
    </Badge>
  </>
));

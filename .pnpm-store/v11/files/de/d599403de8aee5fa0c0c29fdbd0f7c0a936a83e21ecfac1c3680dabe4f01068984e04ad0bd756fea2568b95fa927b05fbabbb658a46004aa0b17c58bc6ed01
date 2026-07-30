"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.sharedGenerateStyle = exports.prepareNotificationToken = exports.default = exports.PurePanelStyle = void 0;
var _cssinjs = require("@ant-design/cssinjs");
var _hooks = require("../../_util/hooks");
var _style = require("../../style");
var _internal = require("../../theme/internal");
var _notification = _interopRequireWildcard(require("./notification"));
var _placement = _interopRequireDefault(require("./placement"));
const DEFAULT_COLLAPSED_STACK_VISIBLE_COUNT = 3;
// =============================== Token ===============================
/** Provide default public ComponentToken values for Notification. */
const prepareComponentToken = token => ({
  zIndexPopup: token.zIndexPopupBase + _hooks.CONTAINER_MAX_OFFSET + 50,
  width: 384,
  progressBg: `linear-gradient(90deg, ${token.colorPrimaryBorderHover}, ${token.colorPrimary})`,
  // Fix notification background color issue
  // https://github.com/ant-design/ant-design/issues/55649
  // https://github.com/ant-design/ant-design/issues/56055
  colorSuccessBg: undefined,
  colorErrorBg: undefined,
  colorInfoBg: undefined,
  colorWarningBg: undefined
});
/** Derive internal Notification style tokens from alias and component tokens. */
const prepareNotificationToken = token => {
  const notificationPaddingVertical = token.paddingMD;
  const notificationPaddingHorizontal = token.paddingLG;
  const notificationToken = (0, _internal.mergeToken)(token, {
    notificationBg: token.colorBgElevated,
    notificationPaddingVertical,
    notificationPaddingHorizontal,
    notificationIconSize: token.calc(token.fontSizeLG).mul(token.lineHeightLG).equal(),
    notificationCloseButtonSize: token.calc(token.controlHeightLG).mul(0.55).equal(),
    notificationMarginBottom: token.margin,
    notificationPadding: `${(0, _cssinjs.unit)(token.paddingMD)} ${(0, _cssinjs.unit)(token.paddingContentHorizontalLG)}`,
    notificationMarginEdge: token.marginLG,
    notificationProgressHeight: 2,
    notificationMotionOffset: 64
  });
  return notificationToken;
};
// =============================== List ================================
/** Build a clip-path inset that keeps stack shadows visible. */
exports.prepareNotificationToken = prepareNotificationToken;
const getStackNoticeClipPath = offset => `inset(${offset} ${offset} ${offset} ${offset})`;
/** Generate shared list content and motion base styles. */
const genNotificationListContentStyle = token => {
  const {
    componentCls,
    motionDurationMid,
    motionDurationSlow,
    motionEaseInOut
  } = token;
  const listCls = `${componentCls}-list`;
  const listContentCls = `${listCls}-content`;
  return {
    [listContentCls]: {
      position: 'relative',
      display: 'flex',
      flexShrink: 0,
      flexDirection: 'column',
      gap: token.notificationMarginBottom,
      width: '100%',
      willChange: 'height, transform',
      transition: 'none',
      [`&${listContentCls}-decrease`]: {
        transition: `height calc(${motionDurationSlow} * 2) ${motionEaseInOut} ${motionDurationMid}`
      }
    },
    // ============================ Motion ============================
    [`${componentCls}-fade`]: {
      backfaceVisibility: 'hidden',
      willChange: 'transform, opacity'
    }
  };
};
/** Generate the root holder, list, stack, and RTL styles for notifications. */
const genNotificationListStyle = (token, config) => {
  const {
    componentCls,
    notificationMarginEdge
  } = token;
  const notificationMarginEdgeVar = '--notification-margin-edge';
  const noticeCls = `${componentCls}-notice`;
  const listCls = `${componentCls}-list`;
  const listWidth = config.listWidthKey ? token.calc(token[config.listWidthKey]).add(token.calc(notificationMarginEdge).mul(2)).equal() : '100%';
  const stackVisibleCount = config.stackVisibleCount ?? DEFAULT_COLLAPSED_STACK_VISIBLE_COUNT;
  const noticeBeyondStackVisibleCountCls = `${noticeCls}:nth-last-child(n + ${stackVisibleCount + 1})`;
  const stackShadowClipOffset = (0, _cssinjs.unit)(token.calc(token.marginXXL).mul(-1).equal());
  const stackNoticeClipPath = getStackNoticeClipPath(stackShadowClipOffset);
  return {
    [componentCls]: {
      ...(0, _style.resetComponent)(token),
      [notificationMarginEdgeVar]: (0, _cssinjs.unit)(notificationMarginEdge),
      // ============================ Holder ============================
      position: 'fixed',
      zIndex: token.zIndexPopup,
      width: listWidth,
      maxWidth: '100vw',
      height: '100vh',
      overflow: 'hidden',
      overscrollBehavior: 'contain',
      [`${componentCls}-hook-holder`]: {
        position: 'relative'
      },
      // ============================= List =============================
      [`&${listCls}`]: {
        maxHeight: '100vh',
        padding: `var(${notificationMarginEdgeVar})`,
        overflowX: 'hidden',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        pointerEvents: 'none',
        '&::-webkit-scrollbar': {
          display: 'none',
          width: 0,
          height: 0
        }
      },
      ...genNotificationListContentStyle(token),
      // ============================ Stack ============================
      [`&${componentCls}-stack`]: {
        [noticeCls]: {
          clipPath: stackNoticeClipPath
        },
        [`&:not(${componentCls}-stack-expanded)`]: {
          [noticeCls]: {
            '--notification-scale': 'calc(1 - min(var(--notification-index, 0), 2) * 0.06)'
          },
          [`${noticeCls}:not(${noticeCls}-stack-in-threshold)`]: {
            opacity: 0,
            pointerEvents: 'none'
          },
          [noticeBeyondStackVisibleCountCls]: {
            opacity: 0,
            pointerEvents: 'none'
          }
        }
      },
      // ============================== RTL =============================
      '&-rtl': {
        direction: 'rtl',
        [`${noticeCls}-actions`]: {
          float: 'left'
        }
      }
    }
  };
};
// ============================== Export ==============================
/** Register the PurePanel sub-style component for Notification. */
const PurePanelStyle = exports.PurePanelStyle = (0, _internal.genSubStyleComponent)(['Notification', 'PurePanel'], token => (0, _notification.genPurePanelStyle)(prepareNotificationToken(token)), prepareComponentToken);
/** Compose the shared list, item, and placement styles. */
const sharedGenerateStyle = (token, config) => {
  const itemStyle = config.itemStyle ?? _notification.default;
  return [genNotificationListStyle(token, config), itemStyle(token), (0, _placement.default)(token)];
};
/** Register the main style hook for Notification. */
exports.sharedGenerateStyle = sharedGenerateStyle;
var _default = exports.default = (0, _internal.genStyleHooks)('Notification', token => {
  const notificationToken = prepareNotificationToken(token);
  return sharedGenerateStyle(notificationToken, {
    listWidthKey: 'width'
  });
}, prepareComponentToken);
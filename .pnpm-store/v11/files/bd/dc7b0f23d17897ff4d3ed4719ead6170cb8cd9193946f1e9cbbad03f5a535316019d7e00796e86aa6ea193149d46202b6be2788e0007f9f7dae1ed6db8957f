"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _cssinjs = require("@ant-design/cssinjs");
var _interface = require("../interface");
const notificationMarginEdgeVar = '--notification-margin-edge';
// ============================== Shared ==============================
/** Resolve the opposite block and inline edges for a placement. */
const getPlacementOffset = (vertical, horizontal) => ({
  blockEnd: vertical === 'top' ? 'bottom' : 'top',
  inlineEnd: horizontal === 'left' ? 'right' : 'left'
});
/** Convert placement offsets into the transform used by notice motion. */
const getMotionTransform = motionOffset => {
  const x = motionOffset?.x ?? '0';
  const y = motionOffset?.y ?? '0';
  return `translate3d(${x}, ${y}, 0) scale(var(--notification-scale, 1))`;
};
/** Build the placement metadata used by position and motion styles. */
const getPlacementStyleConfig = (placement, motionOffset) => {
  const vertical = placement.startsWith('bottom') ? 'bottom' : 'top';
  const horizontal = placement.endsWith('Right') ? 'right' : 'left';
  const {
    blockEnd,
    inlineEnd
  } = getPlacementOffset(vertical, horizontal);
  const isCenterPlacement = placement === 'top' || placement === 'bottom';
  const offset = placement === 'top' || placement.endsWith('Left') ? `-${motionOffset}` : motionOffset;
  return {
    placement,
    vertical,
    blockEnd,
    horizontal,
    inlineEnd,
    motionOffset: isCenterPlacement ? {
      x: '-50%',
      y: offset
    } : {
      x: offset
    },
    baseMotionOffset: isCenterPlacement ? {
      x: '-50%'
    } : undefined,
    isCenterPlacement
  };
};
/** Get the list direction for a vertical placement. */
const getPlacementFlexDirection = vertical => vertical === 'bottom' ? 'column-reverse' : 'column';
/** Keep configured top/bottom as the visible notice edge while list padding preserves shadows. */
const getPlacementInset = vertical => {
  const marginEdge = `var(${notificationMarginEdgeVar}, 0px)`;
  return `calc(var(--notification-${vertical}, ${marginEdge}) - ${marginEdge})`;
};
/** Get the transform origin used by stacked notice scaling. */
const getPlacementTransformOrigin = vertical => vertical === 'bottom' ? 'center top' : 'center bottom';
/** Calculate the clip offset that preserves stack shadows. */
const getStackShadowClipOffset = token => (0, _cssinjs.unit)(token.calc(token.marginXXL).mul(-1).equal());
/** Build the default stack clip-path for a visible notice. */
const getStackNoticeClipPath = token => {
  const offset = getStackShadowClipOffset(token);
  return `inset(${offset} ${offset} ${offset} ${offset})`;
};
/** Build the collapsed stack clip-path for a placement. */
const getPlacementStackClipPath = (token, vertical) => {
  const offset = getStackShadowClipOffset(token);
  return vertical === 'bottom' ? `inset(${offset} ${offset} 50% ${offset})` : `inset(50% ${offset} ${offset} ${offset})`;
};
// ============================= Placement =============================
/** Generate styles for a single notification placement. */
const genPlacementStyle = (token, config) => {
  const {
    componentCls
  } = token;
  const {
    placement,
    vertical,
    blockEnd,
    horizontal,
    inlineEnd,
    // Horizontal centered
    isCenterPlacement
  } = config;
  const noticeCls = `${componentCls}-notice`;
  const noticeMotionCls = `${noticeCls}${componentCls}-fade`;
  // Transform used for enter start and leave end states.
  const enterTransform = getMotionTransform(config.motionOffset);
  // Transform used when fully visible; top/bottom keep translateX(-50%) for centering.
  const baseTransform = getMotionTransform(config.baseMotionOffset);
  const transformOrigin = getPlacementTransformOrigin(vertical);
  return {
    [`&${componentCls}-${placement}`]: {
      [vertical]: getPlacementInset(vertical),
      [blockEnd]: 'auto',
      display: 'flex',
      flexDirection: getPlacementFlexDirection(vertical),
      ...(isCenterPlacement ? {
        marginInline: 0,
        left: '50%',
        right: 'auto',
        transform: 'translateX(-50%)'
      } : {
        [horizontal]: 0,
        [inlineEnd]: 'auto'
      }),
      [noticeCls]: {
        [vertical]: 'var(--notification-y, 0)',
        ...(isCenterPlacement ? {
          left: '50%',
          transform: baseTransform
        } : {
          [horizontal]: 'var(--notification-x, 0)'
        }),
        transformOrigin
      },
      [`${noticeMotionCls}-appear-prepare, ${noticeMotionCls}-enter-prepare`]: {
        opacity: 0,
        transform: enterTransform,
        transition: 'none'
      },
      [`${noticeMotionCls}-appear-start, ${noticeMotionCls}-enter-start`]: {
        opacity: 0,
        transform: enterTransform
      },
      [`${noticeMotionCls}-appear-active, ${noticeMotionCls}-enter-active`]: {
        opacity: 1,
        transform: baseTransform
      },
      [`${noticeMotionCls}-leave-start`]: {
        opacity: 1,
        transform: baseTransform
      },
      [`${noticeMotionCls}-leave-active`]: {
        opacity: 0,
        transform: enterTransform
      },
      [`&${componentCls}-stack:not(${componentCls}-stack-expanded)`]: {
        [noticeCls]: {
          clipPath: getPlacementStackClipPath(token, vertical)
        },
        [`${noticeCls}[data-notification-index='0']`]: {
          clipPath: getStackNoticeClipPath(token)
        }
      }
    }
  };
};
/** Generate placement styles for all enabled notification placements. */
const genNotificationPlacementRootStyle = (token, placements = _interface.NotificationPlacements) => {
  const {
    notificationMotionOffset
  } = token;
  const motionOffset = (0, _cssinjs.unit)(notificationMotionOffset);
  return {
    ...placements.reduce((styles, placement) => ({
      ...styles,
      ...genPlacementStyle(token, getPlacementStyleConfig(placement, motionOffset))
    }), {})
  };
};
// ============================== Export ==============================
/** Wrap placement styles under the component root selector. */
const genNotificationPlacementStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [componentCls]: genNotificationPlacementRootStyle(token)
  };
};
var _default = exports.default = genNotificationPlacementStyle;
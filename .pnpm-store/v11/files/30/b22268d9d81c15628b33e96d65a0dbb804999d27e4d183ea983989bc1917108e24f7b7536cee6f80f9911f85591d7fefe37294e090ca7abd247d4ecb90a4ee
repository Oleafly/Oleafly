import { unit } from '@ant-design/cssinjs';
import { CONTAINER_MAX_OFFSET } from '../../_util/hooks';
import { resetComponent } from '../../style';
import { genStyleHooks, genSubStyleComponent, mergeToken } from '../../theme/internal';
import genNotificationStyle, { genPurePanelStyle } from './notification';
import genNotificationPlacementStyle from './placement';
const DEFAULT_COLLAPSED_STACK_VISIBLE_COUNT = 3;
// =============================== Token ===============================
/** Provide default public ComponentToken values for Notification. */
const prepareComponentToken = token => ({
  zIndexPopup: token.zIndexPopupBase + CONTAINER_MAX_OFFSET + 50,
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
export const prepareNotificationToken = token => {
  const notificationPaddingVertical = token.paddingMD;
  const notificationPaddingHorizontal = token.paddingLG;
  const notificationToken = mergeToken(token, {
    notificationBg: token.colorBgElevated,
    notificationPaddingVertical,
    notificationPaddingHorizontal,
    notificationIconSize: token.calc(token.fontSizeLG).mul(token.lineHeightLG).equal(),
    notificationCloseButtonSize: token.calc(token.controlHeightLG).mul(0.55).equal(),
    notificationMarginBottom: token.margin,
    notificationPadding: `${unit(token.paddingMD)} ${unit(token.paddingContentHorizontalLG)}`,
    notificationMarginEdge: token.marginLG,
    notificationProgressHeight: 2,
    notificationMotionOffset: 64
  });
  return notificationToken;
};
// =============================== List ================================
/** Build a clip-path inset that keeps stack shadows visible. */
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
  const stackShadowClipOffset = unit(token.calc(token.marginXXL).mul(-1).equal());
  const stackNoticeClipPath = getStackNoticeClipPath(stackShadowClipOffset);
  return {
    [componentCls]: {
      ...resetComponent(token),
      [notificationMarginEdgeVar]: unit(notificationMarginEdge),
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
export const PurePanelStyle = genSubStyleComponent(['Notification', 'PurePanel'], token => genPurePanelStyle(prepareNotificationToken(token)), prepareComponentToken);
/** Compose the shared list, item, and placement styles. */
export const sharedGenerateStyle = (token, config) => {
  const itemStyle = config.itemStyle ?? genNotificationStyle;
  return [genNotificationListStyle(token, config), itemStyle(token), genNotificationPlacementStyle(token)];
};
/** Register the main style hook for Notification. */
export default genStyleHooks('Notification', token => {
  const notificationToken = prepareNotificationToken(token);
  return sharedGenerateStyle(notificationToken, {
    listWidthKey: 'width'
  });
}, prepareComponentToken);
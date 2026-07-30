"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.prepareComponentToken = exports.genImageProgressStyle = exports.genImagePreviewStyle = exports.genImageCoverStyle = exports.genBoxStyle = exports.default = void 0;
var _cssinjs = require("@ant-design/cssinjs");
var _fastColor = require("@ant-design/fast-color");
var _internal = require("../../theme/internal");
var _style = require("../../style");
var _progressAnimation = require("./progressAnimation");
const genBoxStyle = position => ({
  position: position || 'absolute',
  inset: 0
});
exports.genBoxStyle = genBoxStyle;
const genImageCoverStyle = token => {
  const {
    componentCls,
    motionDurationSlow,
    colorTextLightSolid
  } = token;
  return {
    [componentCls]: {
      [`${componentCls}-cover`]: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colorTextLightSolid,
        background: new _fastColor.FastColor('#000').setA(0.3).toRgbString(),
        cursor: 'pointer',
        opacity: 0,
        transition: `opacity ${motionDurationSlow}`
      },
      '&:hover, &:focus-visible': {
        [`${componentCls}-cover`]: {
          opacity: 1
        }
      },
      [`${componentCls}-cover-top`]: {
        inset: '0 0 auto 0',
        justifyContent: 'center'
      },
      [`${componentCls}-cover-bottom`]: {
        inset: 'auto 0 0 0',
        justifyContent: 'center'
      }
    }
  };
};
exports.genImageCoverStyle = genImageCoverStyle;
const genImageProgressStyle = token => {
  const {
    componentCls,
    motionDurationMid,
    motionEaseInOut,
    progressAnimationDuration
  } = token;
  // Common ink layer base styles
  const inkBaseStyle = {
    position: 'absolute',
    width: '150%',
    height: '150%',
    left: '-25%',
    top: '-25%',
    animationTimingFunction: motionEaseInOut,
    animationIterationCount: 'infinite',
    pointerEvents: 'none',
    willChange: 'transform, opacity'
  };
  return {
    // Progress root (wrapper)
    [`${componentCls}-progress-wrapper`]: {
      position: 'relative',
      display: 'inline-block',
      overflow: 'hidden',
      borderRadius: 'inherit',
      backgroundColor: token.colorBgBase,
      backdropFilter: 'blur(8px)',
      // Ink group 1: Ink 1 (main) + Ink 2 (::before) + Ink 3 (::after)
      [`${componentCls}-progress-ink-1`]: {
        ...inkBaseStyle,
        // Ink 1 - Top left blue cloud
        background: `radial-gradient(ellipse 65% 55% at 25% 30%, rgba(100, 180, 255, 0.98) 0%, transparent 55%)`,
        animationName: _progressAnimation.inkFlow1,
        animationDuration: progressAnimationDuration,
        filter: 'blur(40px)',
        // Ink 2 - Center right lavender
        '&::before': {
          content: '""',
          ...inkBaseStyle,
          background: `radial-gradient(ellipse 60% 65% at 75% 45%, rgba(180, 140, 255, 0.95) 0%, transparent 50%)`,
          animationName: _progressAnimation.inkFlow2,
          animationDuration: `calc(${progressAnimationDuration} + 2s)`,
          animationDelay: '-1s',
          filter: 'blur(45px)'
        },
        // Ink 3 - Bottom center cyan
        '&::after': {
          content: '""',
          ...inkBaseStyle,
          background: `radial-gradient(ellipse 55% 50% at 50% 70%, rgba(100, 220, 220, 0.9) 0%, transparent 45%)`,
          animationName: _progressAnimation.inkFlow3,
          animationDuration: `calc(${progressAnimationDuration} + 0.5s)`,
          animationDelay: '-2s',
          filter: 'blur(38px)'
        }
      },
      // Ink group 2: Ink 4 (main) + Ink 5 (::before)
      [`${componentCls}-progress-ink-2`]: {
        ...inkBaseStyle,
        // Ink 4 - Scattered pink blossom
        background: `radial-gradient(ellipse 45% 40% at 60% 20%, rgba(255, 150, 200, 0.88) 0%, transparent 45%)`,
        animationName: _progressAnimation.inkFlow3,
        animationDuration: `calc(${progressAnimationDuration} + 1.5s)`,
        animationDelay: '-3s',
        filter: 'blur(42px)',
        // Ink 5 - Soft periwinkle accent
        '&::before': {
          content: '""',
          ...inkBaseStyle,
          background: `radial-gradient(ellipse 50% 55% at 20% 75%, rgba(160, 190, 255, 0.88) 0%, transparent 50%)`,
          animationName: _progressAnimation.inkFlow1,
          animationDuration: `calc(${progressAnimationDuration} + 2.5s)`,
          animationDelay: '-2.5s',
          filter: 'blur(35px)'
        }
      },
      // Progress content
      [`${componentCls}-progress-content`]: {
        position: 'absolute',
        top: '50%',
        left: 0,
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        paddingInline: token.paddingLG,
        textAlign: 'center',
        fontSize: token.fontSize,
        color: token.colorTextSecondary,
        zIndex: 1
      },
      // Progress rail (background container)
      [`${componentCls}-progress-rail`]: {
        width: '100%',
        height: 6,
        marginTop: token.marginSM,
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        borderRadius: token.borderRadiusXS,
        overflow: 'hidden',
        backdropFilter: 'blur(4px)',
        // Track (filled portion) using ::before
        '&::before': {
          content: '""',
          display: 'block',
          height: '100%',
          width: 'var(--progress-percent, 0%)',
          background: 'linear-gradient(90deg, rgba(120, 170, 255, 0.85) 0%, rgba(160, 150, 245, 0.85) 40%, rgba(130, 200, 220, 0.85) 60%, rgba(120, 170, 255, 0.85) 100%)',
          backgroundSize: '200% 100%',
          borderRadius: token.borderRadiusXS / 2,
          transition: `width ${motionDurationMid} ease`,
          animationName: _progressAnimation.progressActive,
          animationDuration: progressAnimationDuration,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite'
        }
      },
      // Progress indicator (percent text)
      [`${componentCls}-progress-indicator`]: {
        marginTop: token.marginXS
      }
    }
  };
};
exports.genImageProgressStyle = genImageProgressStyle;
const genImagePreviewStyle = token => {
  const {
    motionEaseOut,
    previewCls,
    motionDurationSlow,
    componentCls,
    colorBgMask,
    marginXL,
    marginSM,
    margin,
    colorTextLightSolid,
    paddingSM,
    paddingLG,
    previewOperationHoverColor,
    previewOperationColorDisabled,
    previewOperationSize,
    zIndexPopup
  } = token;
  const operationBg = new _fastColor.FastColor(colorBgMask).setA(0.1);
  const operationBgHover = operationBg.clone().setA(0.2);
  const singleBtn = {
    position: 'absolute',
    color: colorTextLightSolid,
    backgroundColor: operationBg.toRgbString(),
    borderRadius: '50%',
    padding: paddingSM,
    outline: 0,
    border: 0,
    cursor: 'pointer',
    transition: `all ${motionDurationSlow}`,
    display: 'flex',
    fontSize: previewOperationSize,
    '&:hover': {
      backgroundColor: operationBgHover.toRgbString()
    },
    '&:active': {
      backgroundColor: operationBg.toRgbString()
    },
    '&:focus-visible': (0, _style.genFocusOutline)(token)
  };
  return {
    [`${componentCls}-preview`]: {
      textAlign: 'center',
      inset: 0,
      position: 'fixed',
      userSelect: 'none',
      zIndex: zIndexPopup,
      // ================= Mask =================
      [`${previewCls}-mask`]: {
        inset: 0,
        position: 'absolute',
        background: colorBgMask,
        backdropFilter: 'blur(0px)',
        transition: `backdrop-filter ${motionDurationSlow}`,
        [`&${componentCls}-preview-mask-blur`]: {
          backdropFilter: 'blur(4px)'
        },
        [`&${componentCls}-preview-mask-hidden`]: {
          display: 'none'
        }
      },
      // ================= Body =================
      [`${previewCls}-body`]: {
        ...genBoxStyle(),
        'pointer-events': 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '> *': {
          pointerEvents: 'auto'
        }
      },
      // Body > Image
      [`${previewCls}-img`]: {
        maxWidth: '100%',
        maxHeight: '70%',
        verticalAlign: 'middle',
        transform: 'scale3d(1, 1, 1)',
        transition: `transform ${motionDurationSlow} ${motionEaseOut} 0s`
      },
      [`&-movable ${previewCls}-img`]: {
        cursor: 'grab'
      },
      [`&-moving ${previewCls}-img`]: {
        cursor: 'grabbing'
      },
      // =============== CloseBtn ===============
      [`${previewCls}-close`]: {
        // Shared style
        ...singleBtn,
        top: marginSM,
        insetInlineEnd: marginSM
      },
      // ================ Switch ================
      [`${previewCls}-switch`]: {
        ...singleBtn,
        top: '50%',
        transform: `translateY(-50%)`,
        '&-disabled': {
          '&, &:hover, &:active': {
            color: previewOperationColorDisabled,
            background: 'transparent',
            cursor: 'not-allowed'
          }
        },
        '&-prev': {
          insetInlineStart: marginSM
        },
        '&-next': {
          insetInlineEnd: marginSM
        }
      },
      // ================ Footer ================
      [`${previewCls}-footer`]: {
        position: 'absolute',
        bottom: marginXL,
        left: {
          _skip_check_: true,
          value: '50%'
        },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        color: token.previewOperationColor,
        transform: 'translateX(-50%)',
        gap: margin
      },
      // =============== Actions ================
      [`${previewCls}-actions`]: {
        display: 'flex',
        gap: paddingSM,
        padding: `0 ${(0, _cssinjs.unit)(paddingLG)}`,
        backgroundColor: operationBg.toRgbString(),
        borderRadius: 100,
        fontSize: previewOperationSize,
        '&-action': {
          color: 'inherit',
          background: 'transparent',
          border: 0,
          font: 'inherit',
          padding: paddingSM,
          cursor: 'pointer',
          transition: `all ${motionDurationSlow}`,
          display: 'flex',
          [`&:not(${previewCls}-actions-action-disabled):hover`]: {
            color: previewOperationHoverColor
          },
          '&:focus-visible': (0, _style.genFocusOutline)(token),
          '&-disabled': {
            color: previewOperationColorDisabled,
            cursor: 'not-allowed'
          }
        }
      }
    }
  };
};
exports.genImagePreviewStyle = genImagePreviewStyle;
const genImageStyle = token => {
  const {
    componentCls
  } = token;
  return {
    // ============================== image ==============================
    [componentCls]: {
      position: 'relative',
      display: 'inline-block',
      ...(0, _style.genFocusStyle)(token),
      [`${componentCls}-img`]: {
        width: '100%',
        height: 'auto',
        verticalAlign: 'middle'
      },
      [`${componentCls}-img-placeholder`]: {
        backgroundColor: token.colorBgContainerDisabled,
        backgroundImage: "url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTQuNSAyLjVoLTEzQS41LjUgMCAwIDAgMSAzdjEwYS41LjUgMCAwIDAgLjUuNWgxM2EuNS41IDAgMCAwIC41LS41VjNhLjUuNSAwIDAgMC0uNS0uNXpNNS4yODEgNC43NWExIDEgMCAwIDEgMCAyIDEgMSAwIDAgMSAwLTJ6bTguMDMgNi44M2EuMTI3LjEyNyAwIDAgMS0uMDgxLjAzSDIuNzY5YS4xMjUuMTI1IDAgMCAxLS4wOTYtLjIwN2wyLjY2MS0zLjE1NmEuMTI2LjEyNiAwIDAgMSAuMTc3LS4wMTZsLjAxNi4wMTZMNy4wOCAxMC4wOWwyLjQ3LTIuOTNhLjEyNi4xMjYgMCAwIDEgLjE3Ny0uMDE2bC4wMTUuMDE2IDMuNTg4IDQuMjQ0YS4xMjcuMTI3IDAgMCAxLS4wMi4xNzV6IiBmaWxsPSIjOEM4QzhDIiBmaWxsLXJ1bGU9Im5vbnplcm8iLz48L3N2Zz4=')",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center center',
        backgroundSize: '30%'
      },
      [`${componentCls}-placeholder`]: {
        ...genBoxStyle()
      }
    }
  };
};
const genPreviewMotion = token => {
  const {
    previewCls,
    motionDurationSlow
  } = token;
  return {
    [previewCls]: {
      '&-fade': {
        transition: `opacity ${motionDurationSlow}`,
        '&-enter, &-appear': {
          opacity: 0,
          [`${previewCls}-body`]: {
            transform: 'scale(0)'
          },
          '&-active': {
            opacity: 1,
            [`${previewCls}-body`]: {
              transform: 'scale(1)',
              transition: `transform ${motionDurationSlow}`
            }
          }
        },
        '&-leave': {
          opacity: 1,
          '&-active': {
            opacity: 0,
            [`${previewCls}-body`]: {
              transform: 'scale(0)',
              transition: `transform ${motionDurationSlow}`
            }
          }
        }
      }
    }
  };
};
// ============================== Export ==============================
const prepareComponentToken = token => ({
  zIndexPopup: token.zIndexPopupBase + 80,
  previewOperationColor: new _fastColor.FastColor(token.colorTextLightSolid).setA(0.65).toRgbString(),
  previewOperationHoverColor: new _fastColor.FastColor(token.colorTextLightSolid).setA(0.85).toRgbString(),
  previewOperationColorDisabled: new _fastColor.FastColor(token.colorTextLightSolid).setA(0.25).toRgbString(),
  previewOperationSize: token.fontSizeIcon * 1.5,
  // FIXME: fontSizeIconLG
  progressAnimationDuration: '3s'
});
exports.prepareComponentToken = prepareComponentToken;
var _default = exports.default = (0, _internal.genStyleHooks)('Image', token => {
  const previewCls = `${token.componentCls}-preview`;
  const imageToken = (0, _internal.mergeToken)(token, {
    previewCls,
    imagePreviewSwitchSize: token.controlHeightLG
  });
  return [genImageStyle(imageToken), genImageCoverStyle(imageToken), genImageProgressStyle(imageToken), genImagePreviewStyle(imageToken), genPreviewMotion(imageToken)];
}, prepareComponentToken);
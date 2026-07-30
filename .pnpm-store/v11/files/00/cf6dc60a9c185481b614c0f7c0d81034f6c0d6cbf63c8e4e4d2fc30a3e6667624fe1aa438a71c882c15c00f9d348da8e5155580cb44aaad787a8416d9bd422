"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.prepareComponentToken = exports.genBaseStyle = exports.default = void 0;
var _cssinjs = require("@ant-design/cssinjs");
var _style = require("../../style");
var _motion = require("../../style/motion");
var _internal = require("../../theme/internal");
const genBaseStyle = token => {
  const {
    componentCls,
    contentBg,
    padding,
    headerBg,
    headerPadding,
    headerPaddingSM,
    headerPaddingLG,
    collapsePanelBorderRadius,
    lineWidth,
    lineType,
    colorBorder,
    colorText,
    colorTextHeading,
    colorTextDisabled,
    fontSizeLG,
    lineHeight,
    lineHeightLG,
    marginSM,
    paddingSM,
    paddingLG,
    paddingXS,
    motionDurationSlow,
    fontSizeIcon,
    contentPadding,
    contentPaddingSM,
    contentPaddingLG,
    fontHeight,
    fontHeightLG
  } = token;
  const borderBase = `${(0, _cssinjs.unit)(lineWidth)} ${lineType} ${colorBorder}`;
  return {
    [componentCls]: {
      ...(0, _style.resetComponent)(token),
      backgroundColor: headerBg,
      border: borderBase,
      borderRadius: collapsePanelBorderRadius,
      '&-rtl': {
        direction: 'rtl'
      },
      [`& > ${componentCls}-item`]: {
        borderBottom: borderBase,
        '&:first-child': {
          [`
            &,
            & > ${componentCls}-header`]: {
            borderRadius: `${(0, _cssinjs.unit)(collapsePanelBorderRadius)} ${(0, _cssinjs.unit)(collapsePanelBorderRadius)} 0 0`
          }
        },
        '&:last-child': {
          [`
            &,
            & > ${componentCls}-header`]: {
            borderRadius: `0 0 ${(0, _cssinjs.unit)(collapsePanelBorderRadius)} ${(0, _cssinjs.unit)(collapsePanelBorderRadius)}`
          }
        },
        [`> ${componentCls}-header`]: {
          position: 'relative',
          // Compatible with old version of antd, should remove in next version
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'flex-start',
          padding: headerPadding,
          color: colorTextHeading,
          lineHeight,
          cursor: 'pointer',
          transition: `all ${motionDurationSlow}, visibility 0s`,
          ...(0, _style.genFocusStyle)(token),
          [`> ${componentCls}-title`]: {
            flex: 'auto'
          },
          // >>>>> Arrow
          [`${componentCls}-expand-icon`]: {
            height: fontHeight,
            display: 'flex',
            alignItems: 'center',
            marginInlineEnd: marginSM
          },
          [`${componentCls}-arrow`]: {
            ...(0, _style.resetIcon)(),
            fontSize: fontSizeIcon,
            // when `transform: rotate()` is applied to icon's root element
            transition: `transform ${motionDurationSlow}`,
            // when `transform: rotate()` is applied to icon's child element
            svg: {
              transition: `transform ${motionDurationSlow}`
            }
          },
          // >>>>> Text
          [`${componentCls}-title`]: {
            marginInlineEnd: 'auto'
          }
        },
        [`${componentCls}-collapsible-header`]: {
          cursor: 'default',
          [`${componentCls}-title`]: {
            flex: 'none',
            cursor: 'pointer'
          },
          [`${componentCls}-expand-icon`]: {
            cursor: 'pointer'
          }
        },
        [`${componentCls}-collapsible-icon`]: {
          cursor: 'unset',
          [`${componentCls}-expand-icon`]: {
            cursor: 'pointer'
          }
        }
      },
      [`${componentCls}-panel`]: {
        color: colorText,
        backgroundColor: contentBg,
        borderTop: borderBase,
        [`& > ${componentCls}-body`]: {
          padding: contentPadding
        },
        '&-hidden': {
          display: 'none'
        }
      },
      '&-small': {
        [`> ${componentCls}-item`]: {
          [`> ${componentCls}-header`]: {
            padding: headerPaddingSM,
            [`> ${componentCls}-expand-icon`]: {
              // Arrow offset
              marginInlineStart: token.calc(paddingSM).sub(paddingXS).equal()
            }
          },
          [`> ${componentCls}-panel > ${componentCls}-body`]: {
            padding: contentPaddingSM
          }
        }
      },
      '&-large': {
        [`> ${componentCls}-item`]: {
          fontSize: fontSizeLG,
          lineHeight: lineHeightLG,
          [`> ${componentCls}-header`]: {
            padding: headerPaddingLG,
            [`> ${componentCls}-expand-icon`]: {
              height: fontHeightLG,
              // Arrow offset
              marginInlineStart: token.calc(paddingLG).sub(padding).equal()
            }
          },
          [`> ${componentCls}-panel > ${componentCls}-body`]: {
            padding: contentPaddingLG
          }
        }
      },
      [`${componentCls}-item:last-child`]: {
        borderBottom: 0,
        [`> ${componentCls}-panel`]: {
          borderRadius: `0 0 ${(0, _cssinjs.unit)(collapsePanelBorderRadius)} ${(0, _cssinjs.unit)(collapsePanelBorderRadius)}`
        }
      },
      [`& ${componentCls}-item-disabled > ${componentCls}-header`]: {
        '&, & > .arrow': {
          color: colorTextDisabled,
          cursor: 'not-allowed'
        }
      },
      // ========================== Icon Placement ==========================
      [`&${componentCls}-icon-placement-end`]: {
        [`& > ${componentCls}-item`]: {
          [`> ${componentCls}-header`]: {
            [`${componentCls}-expand-icon`]: {
              order: 1,
              marginInlineEnd: 0,
              marginInlineStart: marginSM
            }
          }
        }
      }
    }
  };
};
exports.genBaseStyle = genBaseStyle;
const genArrowStyle = token => {
  const {
    componentCls
  } = token;
  const fixedSelector = `> ${componentCls}-item > ${componentCls}-header ${componentCls}-arrow`;
  return {
    [`${componentCls}-rtl`]: {
      [fixedSelector]: {
        transform: `rotate(180deg)`
      }
    }
  };
};
const genBorderlessStyle = token => {
  const {
    componentCls,
    headerBg,
    borderlessContentPadding,
    borderlessContentBg,
    colorBorder
  } = token;
  return {
    [`${componentCls}-borderless`]: {
      backgroundColor: headerBg,
      border: 0,
      [`> ${componentCls}-item`]: {
        borderBottom: `${(0, _cssinjs.unit)(token.lineWidth)} ${token.lineType} ${colorBorder}`
      },
      [`
        > ${componentCls}-item:last-child,
        > ${componentCls}-item:last-child ${componentCls}-header
      `]: {
        borderRadius: 0
      },
      [`> ${componentCls}-item:last-child`]: {
        borderBottom: 0
      },
      [`> ${componentCls}-item > ${componentCls}-panel`]: {
        backgroundColor: borderlessContentBg,
        borderTop: 0
      },
      [`> ${componentCls}-item > ${componentCls}-panel > ${componentCls}-body`]: {
        padding: borderlessContentPadding
      }
    }
  };
};
const genGhostStyle = token => {
  const {
    componentCls,
    paddingSM
  } = token;
  return {
    [`${componentCls}-ghost`]: {
      backgroundColor: 'transparent',
      border: 0,
      [`> ${componentCls}-item`]: {
        borderBottom: 0,
        [`> ${componentCls}-panel`]: {
          backgroundColor: 'transparent',
          border: 0,
          [`> ${componentCls}-body`]: {
            paddingBlock: paddingSM
          }
        }
      }
    }
  };
};
const prepareComponentToken = token => {
  const componentToken = {
    headerPadding: `${(0, _cssinjs.unit)(token.paddingSM)} ${(0, _cssinjs.unit)(token.padding)}`,
    headerPaddingSM: `${(0, _cssinjs.unit)(token.paddingXS)} ${(0, _cssinjs.unit)(token.paddingSM)} ${(0, _cssinjs.unit)(token.paddingXS)} ${(0, _cssinjs.unit)(token.paddingXS)}`,
    headerPaddingLG: `${(0, _cssinjs.unit)(token.padding)} ${(0, _cssinjs.unit)(token.paddingLG)} ${(0, _cssinjs.unit)(token.padding)} ${(0, _cssinjs.unit)(token.padding)}`,
    headerBg: token.colorFillAlter,
    contentPadding: `${(0, _cssinjs.unit)(token.padding)} ${(0, _cssinjs.unit)(16)}`,
    // Fixed Value
    contentPaddingSM: token.paddingSM,
    contentPaddingLG: token.paddingLG,
    contentBg: token.colorBgContainer,
    borderlessContentPadding: `${(0, _cssinjs.unit)(token.paddingXXS)} ${(0, _cssinjs.unit)(16)} ${(0, _cssinjs.unit)(token.padding)}`,
    borderlessContentBg: 'transparent'
  };
  return componentToken;
};
exports.prepareComponentToken = prepareComponentToken;
var _default = exports.default = (0, _internal.genStyleHooks)('Collapse', token => {
  const collapseToken = (0, _internal.mergeToken)(token, {
    collapsePanelBorderRadius: token.borderRadiusLG
  });
  return [genBaseStyle(collapseToken), genBorderlessStyle(collapseToken), genGhostStyle(collapseToken), genArrowStyle(collapseToken), (0, _motion.genCollapseMotion)(collapseToken)];
}, prepareComponentToken);
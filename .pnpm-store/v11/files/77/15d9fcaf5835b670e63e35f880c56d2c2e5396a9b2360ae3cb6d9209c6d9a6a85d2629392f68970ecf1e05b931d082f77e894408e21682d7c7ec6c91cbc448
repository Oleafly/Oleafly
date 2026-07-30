"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _cssinjs = require("@ant-design/cssinjs");
var _internal = require("../../theme/internal");
var _genStyleUtils = require("../../theme/util/genStyleUtils");
var _token = require("./token");
const genSearchStyle = token => {
  const {
    componentCls,
    antCls,
    calc,
    max
  } = token;
  const btnCls = `${componentCls}-btn`;
  const [varName, varRef] = (0, _genStyleUtils.genCssVar)(antCls, 'input-search');
  const inputFontSizeSM = token.inputFontSizeSM ?? token.fontSize;
  const smallButtonHeight = max(token.controlHeightSM, calc(inputFontSizeSM).mul(token.lineHeight).add(calc(token.paddingBlockSM).mul(2)).add(calc(token.lineWidth).mul(2)).equal());
  return {
    [componentCls]: {
      [varName('btn-height')]: (0, _cssinjs.unit)(token.controlHeight),
      width: '100%',
      // =========================== Button ===========================
      [btnCls]: {
        height: varRef('btn-height'),
        '&:focus-visible': {
          zIndex: 5
        },
        [`&${antCls}-btn-icon-only`]: {
          width: varRef('btn-height')
        },
        '&-filled': {
          background: token.colorFillTertiary,
          '&:not(:disabled)': {
            '&:hover': {
              background: token.colorFillSecondary
            },
            '&:active': {
              background: token.colorFill
            }
          }
        }
      },
      [`&${componentCls}-large`]: {
        [varName('btn-height')]: (0, _cssinjs.unit)(token.controlHeightLG)
      },
      [`&${componentCls}-small`]: {
        [varName('btn-height')]: (0, _cssinjs.unit)(token.controlHeightSM)
      },
      [`&${componentCls}-small ${btnCls}`]: {
        minHeight: smallButtonHeight,
        [`&${token.antCls}-btn-icon-only`]: {
          minWidth: smallButtonHeight
        }
      }
    }
  };
};
var _default = exports.default = (0, _internal.genStyleHooks)(['Input', 'Search'], token => {
  const inputToken = (0, _internal.mergeToken)(token, (0, _token.initInputToken)(token));
  return genSearchStyle(inputToken);
}, _token.initComponentToken);
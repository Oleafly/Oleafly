import { unit } from '@ant-design/cssinjs';
import { mergeToken } from '../../theme/internal';
export const genHoverStyle = token => ({
  borderColor: token.hoverBorderColor,
  backgroundColor: token.hoverBg
});
export const genDisabledStyle = token => ({
  color: token.colorTextDisabled,
  backgroundColor: token.colorBgContainerDisabled,
  borderColor: token.colorBorderDisabled,
  boxShadow: 'none',
  cursor: 'not-allowed',
  opacity: 1,
  'input[disabled], textarea[disabled]': {
    cursor: 'not-allowed'
  },
  '&:hover:not([disabled])': {
    ...genHoverStyle(mergeToken(token, {
      hoverBorderColor: token.colorBorderDisabled,
      hoverBg: token.colorBgContainerDisabled
    }))
  }
});
/* ============== Outlined ============== */
export const genBaseOutlinedStyle = (token, options) => ({
  background: token.colorBgContainer,
  borderWidth: token.lineWidth,
  borderStyle: token.lineType,
  borderColor: options.borderColor,
  '&:hover': {
    borderColor: options.hoverBorderColor,
    backgroundColor: token.hoverBg
  },
  '&:focus, &:focus-within': {
    borderColor: options.activeBorderColor,
    boxShadow: options.activeShadow,
    outline: 0,
    backgroundColor: token.activeBg
  }
});
const genOutlinedStatusStyle = (token, options) => ({
  [`&${token.componentCls}-status-${options.status}:not(${token.componentCls}-disabled)`]: {
    ...genBaseOutlinedStyle(token, options),
    [`${token.componentCls}-prefix, ${token.componentCls}-suffix`]: {
      color: options.affixColor
    }
  },
  [`&${token.componentCls}-status-${options.status}${token.componentCls}-disabled`]: {
    borderColor: options.borderColor
  }
});
export const genOutlinedStyle = (token, extraStyles) => ({
  '&-outlined': {
    ...genBaseOutlinedStyle(token, {
      borderColor: token.colorBorder,
      hoverBorderColor: token.hoverBorderColor,
      activeBorderColor: token.activeBorderColor,
      activeShadow: token.activeShadow
    }),
    [`&${token.componentCls}-disabled, &[disabled]`]: {
      ...genDisabledStyle(token)
    },
    ...genOutlinedStatusStyle(token, {
      status: 'error',
      borderColor: token.colorError,
      hoverBorderColor: token.colorErrorBorderHover,
      activeBorderColor: token.colorError,
      activeShadow: token.errorActiveShadow,
      affixColor: token.colorErrorAffix
    }),
    ...genOutlinedStatusStyle(token, {
      status: 'warning',
      borderColor: token.colorWarning,
      hoverBorderColor: token.colorWarningBorderHover,
      activeBorderColor: token.colorWarning,
      activeShadow: token.warningActiveShadow,
      affixColor: token.colorWarningAffix
    }),
    ...extraStyles
  }
});
const genOutlinedGroupStatusStyle = (token, options) => ({
  [`&${token.componentCls}-group-wrapper-status-${options.status}`]: {
    [`${token.componentCls}-group-addon`]: {
      borderColor: options.addonBorderColor,
      color: options.addonColor
    }
  }
});
export const genOutlinedGroupStyle = token => ({
  '&-outlined': {
    [`${token.componentCls}-group`]: {
      '&-addon': {
        background: token.addonBg,
        border: `${unit(token.lineWidth)} ${token.lineType} ${token.colorBorder}`
      },
      '&-addon:first-child': {
        borderInlineEnd: 0
      },
      '&-addon:last-child': {
        borderInlineStart: 0
      }
    },
    ...genOutlinedGroupStatusStyle(token, {
      status: 'error',
      addonBorderColor: token.colorError,
      addonColor: token.colorErrorText
    }),
    ...genOutlinedGroupStatusStyle(token, {
      status: 'warning',
      addonBorderColor: token.colorWarning,
      addonColor: token.colorWarningText
    }),
    [`&${token.componentCls}-group-wrapper-disabled`]: {
      [`${token.componentCls}-group-addon`]: {
        ...genDisabledStyle(token)
      }
    }
  }
});
/* ============ Borderless ============ */
const borderlessFocusVisibleSelector = '&:focus-visible, &:has(input:focus-visible), &:has(textarea:focus-visible)';
const genBorderlessFocusVisibleStyle = (token, outlineColor) => ({
  outline: `${unit(token.lineWidth)} ${token.lineType} ${outlineColor}`,
  outlineOffset: unit(token.calc(token.lineWidth).mul(-1).equal()),
  transition: [`outline-offset`, `outline`].map(prop => `${prop} 0s`).join(', ')
});
const genBorderlessStatusStyle = (token, options) => ({
  '&, & input, & textarea': {
    color: options.color
  },
  [borderlessFocusVisibleSelector]: genBorderlessFocusVisibleStyle(token, options.color),
  [`${token.componentCls}-prefix, ${token.componentCls}-suffix`]: {
    color: options.affixColor
  }
});
export const genBorderlessStyle = (token, extraStyles) => {
  const {
    componentCls
  } = token;
  return {
    '&-borderless': {
      background: 'transparent',
      border: 'none',
      // Compensate for the removed border to maintain consistent height with other components
      // (e.g. Select borderless) that keep a transparent border.
      paddingBlock: token.calc(token.paddingBlock).add(token.lineWidth).equal(),
      [`&${componentCls}-sm, &${componentCls}-affix-wrapper-sm`]: {
        paddingBlock: token.calc(token.paddingBlockSM).add(token.lineWidth).equal()
      },
      [`&${componentCls}-lg, &${componentCls}-affix-wrapper-lg`]: {
        paddingBlock: token.calc(token.paddingBlockLG).add(token.lineWidth).equal()
      },
      '&:focus, &:focus-within': {
        outline: 'none'
      },
      [borderlessFocusVisibleSelector]: genBorderlessFocusVisibleStyle(token, token.activeBorderColor),
      // >>>>> Disabled
      [`&${componentCls}-disabled, &[disabled]`]: {
        color: token.colorTextDisabled,
        cursor: 'not-allowed'
      },
      // >>>>> Status
      [`&${componentCls}-status-error`]: genBorderlessStatusStyle(token, {
        color: token.colorError,
        affixColor: token.colorErrorAffix
      }),
      [`&${componentCls}-status-warning`]: genBorderlessStatusStyle(token, {
        color: token.colorWarning,
        affixColor: token.colorWarningAffix
      }),
      ...extraStyles
    }
  };
};
/* ============== Filled ============== */
const genBaseFilledStyle = (token, options) => ({
  background: options.bg,
  borderWidth: token.lineWidth,
  borderStyle: token.lineType,
  borderColor: 'transparent',
  'input&, & input, textarea&, & textarea': {
    color: options?.inputColor ?? 'unset'
  },
  '&:hover': {
    background: options.hoverBg
  },
  '&:focus, &:focus-within': {
    outline: 0,
    borderColor: options.activeBorderColor,
    backgroundColor: token.activeBg
  }
});
const genFilledStatusStyle = (token, options) => ({
  [`&${token.componentCls}-status-${options.status}:not(${token.componentCls}-disabled)`]: {
    ...genBaseFilledStyle(token, options),
    [`${token.componentCls}-prefix, ${token.componentCls}-suffix`]: {
      color: options.affixColor
    }
  }
});
export const genFilledStyle = (token, extraStyles) => ({
  '&-filled': {
    ...genBaseFilledStyle(token, {
      bg: token.colorFillTertiary,
      hoverBg: token.colorFillSecondary,
      activeBorderColor: token.activeBorderColor,
      inputColor: token.colorText
    }),
    [`&${token.componentCls}-disabled, &[disabled]`]: {
      ...genDisabledStyle(token)
    },
    ...genFilledStatusStyle(token, {
      status: 'error',
      bg: token.colorErrorBg,
      hoverBg: token.colorErrorBgHover,
      activeBorderColor: token.colorError,
      inputColor: token.colorErrorText,
      affixColor: token.colorErrorAffix
    }),
    ...genFilledStatusStyle(token, {
      status: 'warning',
      bg: token.colorWarningBg,
      hoverBg: token.colorWarningBgHover,
      activeBorderColor: token.colorWarning,
      inputColor: token.colorWarningText,
      affixColor: token.colorWarningAffix
    }),
    ...extraStyles
  }
});
const genFilledGroupStatusStyle = (token, options) => ({
  [`&${token.componentCls}-group-wrapper-status-${options.status}`]: {
    [`${token.componentCls}-group-addon`]: {
      background: options.addonBg,
      color: options.addonColor
    }
  }
});
export const genFilledGroupStyle = token => ({
  '&-filled': {
    [`${token.componentCls}-group-addon`]: {
      background: token.colorFillTertiary,
      '&:last-child': {
        position: 'static'
      }
    },
    ...genFilledGroupStatusStyle(token, {
      status: 'error',
      addonBg: token.colorErrorBg,
      addonColor: token.colorErrorText
    }),
    ...genFilledGroupStatusStyle(token, {
      status: 'warning',
      addonBg: token.colorWarningBg,
      addonColor: token.colorWarningText
    }),
    [`&${token.componentCls}-group-wrapper-disabled`]: {
      [`${token.componentCls}-group`]: {
        '&-addon': {
          background: token.colorFillTertiary,
          color: token.colorTextDisabled
        },
        '&-addon:first-child': {
          borderInlineStart: `${unit(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
          borderTop: `${unit(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
          borderBottom: `${unit(token.lineWidth)} ${token.lineType} ${token.colorBorder}`
        },
        '&-addon:last-child': {
          borderInlineEnd: `${unit(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
          borderTop: `${unit(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
          borderBottom: `${unit(token.lineWidth)} ${token.lineType} ${token.colorBorder}`
        }
      }
    }
  }
});
/* ============== Underlined ============== */
// https://github.com/ant-design/ant-design/issues/51379
export const genBaseUnderlinedStyle = (token, options) => ({
  background: token.colorBgContainer,
  borderWidth: `${unit(token.lineWidth)} 0`,
  borderStyle: `${token.lineType} none`,
  borderColor: `transparent transparent ${options.borderColor} transparent`,
  borderRadius: 0,
  '&:hover': {
    borderColor: `transparent transparent ${options.hoverBorderColor} transparent`,
    backgroundColor: token.hoverBg
  },
  '&:focus, &:focus-within': {
    borderColor: `transparent transparent ${options.activeBorderColor} transparent`,
    outline: 0,
    backgroundColor: token.activeBg
  }
});
const genUnderlinedStatusStyle = (token, options) => ({
  [`&${token.componentCls}-status-${options.status}:not(${token.componentCls}-disabled)`]: {
    ...genBaseUnderlinedStyle(token, options),
    [`${token.componentCls}-prefix, ${token.componentCls}-suffix`]: {
      color: options.affixColor
    }
  },
  [`&${token.componentCls}-status-${options.status}${token.componentCls}-disabled`]: {
    borderColor: `transparent transparent ${options.borderColor} transparent`
  }
});
export const genUnderlinedStyle = (token, extraStyles) => ({
  '&-underlined': {
    ...genBaseUnderlinedStyle(token, {
      borderColor: token.colorBorder,
      hoverBorderColor: token.hoverBorderColor,
      activeBorderColor: token.activeBorderColor,
      activeShadow: token.activeShadow
    }),
    // >>>>> Disabled
    [`&${token.componentCls}-disabled, &[disabled]`]: {
      color: token.colorTextDisabled,
      boxShadow: 'none',
      cursor: 'not-allowed',
      '&:hover': {
        borderColor: `transparent transparent ${token.colorBorder} transparent`
      }
    },
    'input[disabled], textarea[disabled]': {
      cursor: 'not-allowed'
    },
    ...genUnderlinedStatusStyle(token, {
      status: 'error',
      borderColor: token.colorError,
      hoverBorderColor: token.colorErrorBorderHover,
      activeBorderColor: token.colorError,
      activeShadow: token.errorActiveShadow,
      affixColor: token.colorErrorAffix
    }),
    ...genUnderlinedStatusStyle(token, {
      status: 'warning',
      borderColor: token.colorWarning,
      hoverBorderColor: token.colorWarningBorderHover,
      activeBorderColor: token.colorWarning,
      activeShadow: token.warningActiveShadow,
      affixColor: token.colorWarningAffix
    }),
    ...extraStyles
  }
});
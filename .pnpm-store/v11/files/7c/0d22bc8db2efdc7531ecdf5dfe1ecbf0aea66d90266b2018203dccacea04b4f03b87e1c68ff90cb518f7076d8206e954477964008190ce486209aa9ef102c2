import { unit } from '@ant-design/cssinjs';
import { genFocusStyle, resetComponent } from '../../style';
import { genStyleHooks } from '../../theme/internal';
const genAlertTypeStyle = (bgColor, iconColor, alertCls) => ({
  background: bgColor,
  [`${alertCls}-icon`]: {
    color: iconColor
  }
});
export const genBaseStyle = token => {
  const {
    componentCls,
    motionDurationSlow: duration,
    marginXS,
    marginSM,
    fontSize,
    fontSizeLG,
    lineHeight,
    borderRadiusLG: borderRadius,
    motionEaseInOutCirc,
    withDescriptionIconSize,
    colorText,
    colorTextHeading,
    withDescriptionPadding,
    defaultPadding,
    lineWidth,
    lineType,
    colorSuccessBorder,
    colorWarningBorder,
    colorErrorBorder,
    colorInfoBorder
  } = token;
  return {
    [componentCls]: {
      ...resetComponent(token),
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      padding: defaultPadding,
      wordWrap: 'break-word',
      borderRadius,
      borderWidth: unit(lineWidth),
      borderStyle: lineType,
      [`&${componentCls}-success`]: {
        borderColor: colorSuccessBorder
      },
      [`&${componentCls}-info`]: {
        borderColor: colorInfoBorder
      },
      [`&${componentCls}-warning`]: {
        borderColor: colorWarningBorder
      },
      [`&${componentCls}-error`]: {
        borderColor: colorErrorBorder
      },
      [`&${componentCls}-filled`]: {
        borderColor: 'transparent'
      },
      [`&${componentCls}-rtl`]: {
        direction: 'rtl'
      },
      [`${componentCls}-section`]: {
        flex: 1,
        minWidth: 0
      },
      [`${componentCls}-icon`]: {
        marginInlineEnd: marginXS,
        lineHeight: 0
      },
      '&-description': {
        display: 'none',
        fontSize,
        lineHeight
      },
      '&-title': {
        color: colorTextHeading
      },
      [`&${componentCls}-motion-leave`]: {
        overflow: 'hidden',
        opacity: 1,
        transition: [`max-height`, `opacity`, `padding-top`, `padding-bottom`, `margin-bottom`].map(prop => `${prop} ${duration} ${motionEaseInOutCirc}`).join(', ')
      },
      [`&${componentCls}-motion-leave-active`]: {
        maxHeight: 0,
        marginBottom: '0 !important',
        paddingTop: 0,
        paddingBottom: 0,
        opacity: 0
      },
      [`&${componentCls}-with-description`]: {
        alignItems: 'flex-start',
        padding: withDescriptionPadding,
        [`${componentCls}-icon`]: {
          marginInlineEnd: marginSM,
          fontSize: withDescriptionIconSize,
          lineHeight: 0
        },
        [`${componentCls}-title`]: {
          display: 'block',
          marginBottom: marginXS,
          color: colorTextHeading,
          fontSize: fontSizeLG
        },
        [`${componentCls}-description`]: {
          display: 'block',
          color: colorText
        }
      },
      [`&${componentCls}-banner`]: {
        marginBottom: 0,
        border: '0 !important',
        borderRadius: 0
      }
    }
  };
};
export const genTypeStyle = token => {
  const {
    componentCls,
    colorSuccess,
    colorSuccessBg,
    colorWarning,
    colorWarningBg,
    colorError,
    colorErrorBg,
    colorInfo,
    colorInfoBg
  } = token;
  return {
    [componentCls]: {
      '&-success': genAlertTypeStyle(colorSuccessBg, colorSuccess, componentCls),
      '&-info': genAlertTypeStyle(colorInfoBg, colorInfo, componentCls),
      '&-warning': genAlertTypeStyle(colorWarningBg, colorWarning, componentCls),
      '&-error': {
        ...genAlertTypeStyle(colorErrorBg, colorError, componentCls),
        [`${componentCls}-description > pre`]: {
          margin: 0,
          padding: 0
        }
      }
    }
  };
};
export const genActionStyle = token => {
  const {
    componentCls,
    iconCls,
    motionDurationMid,
    marginXS,
    fontSizeIcon,
    colorIcon,
    colorIconHover
  } = token;
  return {
    [componentCls]: {
      [`${componentCls}-actions`]: {
        marginInlineStart: marginXS
      },
      [`${componentCls}-close-icon`]: {
        marginInlineStart: marginXS,
        padding: 0,
        overflow: 'hidden',
        fontSize: fontSizeIcon,
        lineHeight: unit(fontSizeIcon),
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        ...genFocusStyle(token),
        [`${iconCls}-close`]: {
          color: colorIcon,
          transition: `color ${motionDurationMid}`,
          '&:hover': {
            color: colorIconHover
          }
        }
      },
      '&-close-text': {
        color: colorIcon,
        transition: `color ${motionDurationMid}`,
        '&:hover': {
          color: colorIconHover
        }
      }
    }
  };
};
export const prepareComponentToken = token => {
  const paddingHorizontal = 12; // Fixed value here.
  return {
    withDescriptionIconSize: token.fontSizeHeading3,
    defaultPadding: `${token.paddingContentVerticalSM}px ${paddingHorizontal}px`,
    withDescriptionPadding: `${token.paddingMD}px ${token.paddingContentHorizontalLG}px`
  };
};
export default genStyleHooks('Alert', token => [genBaseStyle(token), genTypeStyle(token), genActionStyle(token)], prepareComponentToken);
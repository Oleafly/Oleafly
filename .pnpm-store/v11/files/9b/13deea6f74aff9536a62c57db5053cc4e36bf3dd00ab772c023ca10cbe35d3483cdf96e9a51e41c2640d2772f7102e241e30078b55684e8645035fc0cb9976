import { unit } from '@ant-design/cssinjs';
import { isNumber } from '../../_util/is';
import { genStyleHooks, mergeToken } from '../../theme/internal';
// ============================== Styles ==============================
const genBaseStyle = token => {
  const {
    componentCls,
    lineHeightHeading3,
    iconCls,
    padding,
    paddingXL,
    paddingXS,
    paddingLG,
    marginXS,
    lineHeight
  } = token;
  return {
    // Result
    [componentCls]: {
      padding: `${unit(token.calc(paddingLG).mul(2).equal())} ${unit(paddingXL)}`,
      // RTL
      '&-rtl': {
        direction: 'rtl'
      }
    },
    // Exception Status image
    [`${componentCls} ${componentCls}-image`]: {
      width: token.imageWidth,
      height: token.imageHeight,
      margin: 'auto'
    },
    [`${componentCls} ${componentCls}-icon`]: {
      marginBottom: paddingLG,
      textAlign: 'center',
      [`& > ${iconCls}`]: {
        fontSize: token.iconFontSize
      }
    },
    [`${componentCls} ${componentCls}-title`]: {
      color: token.colorTextHeading,
      fontSize: token.titleFontSize,
      lineHeight: lineHeightHeading3,
      marginBlock: marginXS,
      textAlign: 'center'
    },
    [`${componentCls} ${componentCls}-subtitle`]: {
      color: token.colorTextDescription,
      fontSize: token.subtitleFontSize,
      lineHeight,
      textAlign: 'center'
    },
    [`${componentCls} ${componentCls}-body`]: {
      marginTop: paddingLG,
      padding: `${unit(paddingLG)} ${unit(token.calc(padding).mul(2.5).equal())}`,
      backgroundColor: token.colorFillAlter
    },
    [`${componentCls} ${componentCls}-extra`]: {
      margin: token.extraMargin,
      textAlign: 'center',
      '& > *': {
        marginInlineEnd: paddingXS,
        '&:last-child': {
          marginInlineEnd: 0
        }
      }
    }
  };
};
const genStatusIconStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-success ${componentCls}-icon`]: {
      color: token.resultSuccessIconColor
    },
    [`${componentCls}-error ${componentCls}-icon`]: {
      color: token.resultErrorIconColor
    },
    [`${componentCls}-info ${componentCls}-icon`]: {
      color: token.resultInfoIconColor
    },
    [`${componentCls}-warning ${componentCls}-icon`]: {
      color: token.resultWarningIconColor
    }
  };
};
const genResultStyle = token => [genBaseStyle(token), genStatusIconStyle(token)];
// ============================== Export ==============================
export const prepareComponentToken = token => {
  const {
    fontSizeHeading3,
    fontSize,
    paddingLG
  } = token;
  return {
    titleFontSize: fontSizeHeading3,
    subtitleFontSize: fontSize,
    iconFontSize: isNumber(fontSizeHeading3) ? fontSizeHeading3 * 3 : `calc(${fontSizeHeading3} * 3)`,
    extraMargin: `${paddingLG}px 0 0 0`
  };
};
export default genStyleHooks('Result', token => {
  const resultInfoIconColor = token.colorInfo;
  const resultErrorIconColor = token.colorError;
  const resultSuccessIconColor = token.colorSuccess;
  const resultWarningIconColor = token.colorWarning;
  const resultToken = mergeToken(token, {
    resultInfoIconColor,
    resultErrorIconColor,
    resultSuccessIconColor,
    resultWarningIconColor,
    imageWidth: 250,
    imageHeight: 295
  });
  return genResultStyle(resultToken);
}, prepareComponentToken);
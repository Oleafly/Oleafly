const genSelectInputCustomizeStyle = token => {
  const {
    antCls,
    componentCls
  } = token;
  const transparentBackground = {
    background: 'transparent'
  };
  const disabledCustomizedInputSelector = ['> input[disabled]', '> textarea[disabled]', `> ${componentCls}-input`, `> ${antCls}-input-affix-wrapper-disabled`, `> ${antCls}-input-search`].join(', ');
  return {
    [`&${componentCls}-customize`]: {
      border: 0,
      padding: 0,
      fontSize: 'inherit',
      lineHeight: 'inherit',
      [`${componentCls}-placeholder`]: {
        display: 'none'
      },
      [`${componentCls}-content`]: {
        margin: 0,
        padding: 0,
        '&-value': {
          display: 'none'
        }
      },
      [`&${componentCls}-filled ${componentCls}-content`]: {
        [`${antCls}-input-filled`]: transparentBackground
      },
      [`&${componentCls}-disabled ${componentCls}-content`]: {
        [disabledCustomizedInputSelector]: transparentBackground,
        'input[disabled], textarea[disabled]': transparentBackground
      }
    }
  };
};
export default genSelectInputCustomizeStyle;
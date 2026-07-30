// handle border collapse
function compactItemBorder(token, parentCls, options, prefixCls) {
  const {
    focusElCls,
    focus,
    borderElCls
  } = options;
  const childCombinator = borderElCls ? '> *' : '';
  const suffix = childCombinator ? ` ${childCombinator}` : '';
  const genEffects = effects => effects.filter(Boolean).map(n => `&:${n}${suffix}`).join(',');
  const hoverEffects = genEffects(['hover', focusElCls ? `hover${focusElCls}` : null]);
  const focusEffects = genEffects([focus ? 'focus' : null, 'active']);
  return {
    [`&-item:not(${parentCls}-last-item)`]: {
      marginInlineEnd: token.calc(token.lineWidth).mul(-1).equal()
    },
    [`&-item:not(${prefixCls}-status-success)`]: {
      zIndex: 2
    },
    '&-item': {
      [focusEffects]: {
        zIndex: 3
      },
      [hoverEffects]: {
        zIndex: 4
      },
      ...(focusElCls ? {
        [`&${focusElCls}`]: {
          zIndex: 3
        }
      } : {}),
      [`&[disabled] ${childCombinator}`]: {
        zIndex: 0
      }
    }
  };
}
// handle border-radius
function compactItemBorderRadius(prefixCls, parentCls, options) {
  const {
    borderElCls
  } = options;
  const childCombinator = borderElCls ? `> ${borderElCls}` : '';
  return {
    [`&-item:not(${parentCls}-first-item):not(${parentCls}-last-item) ${childCombinator}`]: {
      borderRadius: 0
    },
    [`&-item:not(${parentCls}-last-item)${parentCls}-first-item`]: {
      [`& ${childCombinator}, &${prefixCls}-sm ${childCombinator}, &${prefixCls}-lg ${childCombinator}`]: {
        borderStartEndRadius: 0,
        borderEndEndRadius: 0
      }
    },
    [`&-item:not(${parentCls}-first-item)${parentCls}-last-item`]: {
      [`& ${childCombinator}, &${prefixCls}-sm ${childCombinator}, &${prefixCls}-lg ${childCombinator}`]: {
        borderStartStartRadius: 0,
        borderEndStartRadius: 0
      }
    }
  };
}
export function genCompactItemStyle(token, options = {
  focus: true
}) {
  const {
    componentCls
  } = token;
  const {
    componentCls: customizePrefixCls
  } = options;
  const mergedComponentCls = customizePrefixCls || componentCls;
  const compactCls = `${mergedComponentCls}-compact`;
  return {
    [compactCls]: {
      ...compactItemBorder(token, compactCls, options, mergedComponentCls),
      ...compactItemBorderRadius(mergedComponentCls, compactCls, options)
    }
  };
}
import { useMemo } from 'react';
import { useMergeSemantic } from '../../_util/hooks/useMergeSemantic';
import { useComponentConfig } from '../../config-provider/context';
export const useTypographySemantic = (customizePrefixCls, classNames, styles, typographyDirection, props) => {
  const {
    getPrefixCls,
    direction: contextDirection,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('typography');
  const direction = typographyDirection ?? contextDirection;
  const prefixCls = getPrefixCls('typography', customizePrefixCls);
  const mergedProps = {
    ...props,
    prefixCls,
    direction
  };
  const contextClassNamesObject = useMemo(() => ({
    root: contextClassName
  }), [contextClassName]);
  const contextStylesObject = useMemo(() => ({
    root: contextStyle
  }), [contextStyle]);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNamesObject, contextClassNames, classNames], [contextStylesObject, contextStyles, styles], {
    props: mergedProps
  });
  return [mergedClassNames, mergedStyles, prefixCls, direction];
};
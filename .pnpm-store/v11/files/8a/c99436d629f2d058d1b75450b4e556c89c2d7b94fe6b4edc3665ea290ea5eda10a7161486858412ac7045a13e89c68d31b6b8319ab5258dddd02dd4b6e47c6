import React from 'react';
const DEFAULT_BORDER_INFO = {
  borderWidth: [0, 0, 0, 0],
  borderRadius: '0px'
};
const parseBorderWidth = value => {
  const size = Number.parseFloat(value);
  return Number.isFinite(size) ? size : 0;
};
const useBorderSize = domNode => {
  const [borderInfo, setBorderInfo] = React.useState(DEFAULT_BORDER_INFO);
  React.useEffect(() => {
    if (!domNode) {
      setBorderInfo(DEFAULT_BORDER_INFO);
      return;
    }
    const {
      borderTopWidth,
      borderRightWidth,
      borderBottomWidth,
      borderLeftWidth,
      borderRadius
    } = getComputedStyle(domNode);
    setBorderInfo({
      borderWidth: [parseBorderWidth(borderTopWidth), parseBorderWidth(borderRightWidth), parseBorderWidth(borderBottomWidth), parseBorderWidth(borderLeftWidth)],
      borderRadius
    });
  }, [domNode]);
  return borderInfo;
};
export default useBorderSize;
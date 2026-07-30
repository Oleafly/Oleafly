import { warning } from '@rc-component/util';
import * as React from 'react';
export default function useCellRender(cellRender, dateRender, monthCellRender, range) {
  // ========================= Warn =========================
  if (process.env.NODE_ENV !== 'production') {
    warning(!dateRender, `'dateRender' is deprecated. Please use 'cellRender' instead.`);
    warning(!monthCellRender, `'monthCellRender' is deprecated. Please use 'cellRender' instead.`);
  }

  // ======================== Render ========================
  // Merged render
  const mergedCellRender = React.useMemo(() => {
    if (cellRender) {
      return cellRender;
    }
    return (current, info) => {
      const date = current;
      if (dateRender && info.type === 'date') {
        return dateRender(date, info.today);
      }
      if (monthCellRender && info.type === 'month') {
        return monthCellRender(date, info.locale);
      }
      return info.originNode;
    };
  }, [cellRender, monthCellRender, dateRender]);

  // Cell render
  const onInternalCellRender = React.useCallback((date, info) => mergedCellRender(date, {
    ...info,
    range
  }), [mergedCellRender, range]);
  return onInternalCellRender;
}
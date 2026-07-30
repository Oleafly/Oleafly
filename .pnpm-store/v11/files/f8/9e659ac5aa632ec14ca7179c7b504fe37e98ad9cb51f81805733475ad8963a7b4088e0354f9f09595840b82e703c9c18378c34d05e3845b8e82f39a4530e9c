import * as React from 'react';
import { EXPAND_COLUMN } from '@rc-component/table';
import { mergeProps, omit } from '@rc-component/util';
import { SELECTION_COLUMN } from './useSelection';
const useFilledColumns = (columns, column) => React.useMemo(() => {
  if (!column) {
    return columns;
  }
  const fillColumns = currentColumns => currentColumns.map(col => {
    if (col === SELECTION_COLUMN || col === EXPAND_COLUMN) {
      return col;
    }
    if ('children' in col && Array.isArray(col.children)) {
      const mergedColumn = mergeProps(column, col);
      return {
        ...mergedColumn,
        children: fillColumns(col.children)
      };
    }
    const columnWithoutChildren = omit(column, ['children']);
    return mergeProps(columnWithoutChildren, col);
  });
  return fillColumns(columns);
}, [columns, column]);
export default useFilledColumns;
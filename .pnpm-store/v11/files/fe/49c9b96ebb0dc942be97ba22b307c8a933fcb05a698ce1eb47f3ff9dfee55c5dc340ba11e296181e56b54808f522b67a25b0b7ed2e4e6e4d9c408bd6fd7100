import React from 'react';
import { isNonNullable } from '../../_util/is';
const getMergedFilters = filters => {
  const mergedFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (isNonNullable(value)) {
      mergedFilters[key] = value;
    }
  }
  return mergedFilters;
};
const useColumnTitleProps = (sorterTitleProps, filters) => {
  const columnTitleProps = React.useMemo(() => {
    return {
      ...sorterTitleProps,
      filters: getMergedFilters(filters)
    };
  }, [sorterTitleProps, filters]);
  return columnTitleProps;
};
export default useColumnTitleProps;
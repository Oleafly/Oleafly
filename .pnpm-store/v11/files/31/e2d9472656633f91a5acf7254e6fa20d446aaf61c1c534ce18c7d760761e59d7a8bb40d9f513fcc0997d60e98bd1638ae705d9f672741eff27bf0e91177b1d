import { useState } from 'react';
import { mergeProps } from '@rc-component/util';
import { isFunction, isPlainObject } from '../../_util/is';
export const DEFAULT_PAGE_SIZE = 10;
export function getPaginationParam(mergedPagination, pagination) {
  const param = {
    current: mergedPagination.current,
    pageSize: mergedPagination.pageSize
  };
  const paginationObj = isPlainObject(pagination) ? pagination : {};
  Object.keys(paginationObj).forEach(pageProp => {
    const value = mergedPagination[pageProp];
    if (!isFunction(value)) {
      param[pageProp] = value;
    }
  });
  return param;
}
function usePagination(total, onChange, pagination) {
  const {
    total: paginationTotal = 0,
    ...paginationObj
  } = isPlainObject(pagination) ? pagination : {};
  const [innerPagination, setInnerPagination] = useState(() => ({
    current: 'defaultCurrent' in paginationObj ? paginationObj.defaultCurrent : 1,
    pageSize: 'defaultPageSize' in paginationObj ? paginationObj.defaultPageSize : DEFAULT_PAGE_SIZE
  }));
  // ============ Basic Pagination Config ============
  const mergedPagination = mergeProps(innerPagination, paginationObj, {
    total: paginationTotal > 0 ? paginationTotal : total
  });
  // Reset `current` if data length or pageSize changed
  const maxPage = Math.ceil((paginationTotal || total) / mergedPagination.pageSize);
  if (mergedPagination.current > maxPage) {
    // Prevent a maximum page count of 0
    mergedPagination.current = maxPage || 1;
  }
  const refreshPagination = (current, pageSize) => {
    setInnerPagination({
      current: current ?? 1,
      pageSize: pageSize || mergedPagination.pageSize
    });
  };
  const onInternalChange = (current, pageSize) => {
    if (pagination) {
      pagination.onChange?.(current, pageSize);
    }
    refreshPagination(current, pageSize);
    onChange(current, pageSize || mergedPagination?.pageSize);
  };
  if (pagination === false) {
    return [{}, () => {}];
  }
  return [{
    ...mergedPagination,
    onChange: onInternalChange
  }, refreshPagination];
}
export default usePagination;
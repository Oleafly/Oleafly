import { isEqual, useMemo } from '@rc-component/util';
import { getCellFixedInfo } from "../utils/fixUtil";
import * as React from 'react';
export default function useFixedInfo(flattenColumns, stickyOffsets) {
  const fixedInfoList = React.useMemo(() => flattenColumns.map((_, colIndex) => getCellFixedInfo(colIndex, colIndex, flattenColumns, stickyOffsets)), [flattenColumns, stickyOffsets]);
  return useMemo(() => fixedInfoList, [fixedInfoList], (prev, next) => !isEqual(prev, next));
}
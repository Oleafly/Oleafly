import * as React from 'react';
import { getTargetScrollBarSize, removeCSS, updateCSS, useLayoutEffect } from '@rc-component/util';
import { isBodyOverflowing } from "./util";
const UNIQUE_ID = `rc-util-locker-${Date.now()}`;
let uuid = 0;
export default function useScrollLocker(lock) {
  const mergedLock = !!lock;
  const [id] = React.useState(() => {
    uuid += 1;
    return `${UNIQUE_ID}_${uuid}`;
  });
  useLayoutEffect(() => {
    if (mergedLock) {
      const scrollbarSize = getTargetScrollBarSize(document.body).width;
      const isOverflow = isBodyOverflowing();
      updateCSS(`
html body {
  overflow-y: hidden;
  ${isOverflow ? `width: calc(100% - ${scrollbarSize}px);` : ''}
}`, id);
    } else {
      removeCSS(id);
    }
    return () => {
      removeCSS(id);
    };
  }, [mergedLock, id]);
}
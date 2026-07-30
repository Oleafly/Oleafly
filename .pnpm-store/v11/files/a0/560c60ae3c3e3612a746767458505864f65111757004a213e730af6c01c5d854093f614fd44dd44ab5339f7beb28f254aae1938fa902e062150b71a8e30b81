import { raf } from '@rc-component/util';
import { easeInOutCubic } from './easings';
import getScroll, { isDocument, isWindow } from './getScroll';
import { isFunction } from './is';
export default function scrollTo(y, options = {}) {
  const {
    getContainer = () => window,
    callback,
    duration = 450
  } = options;
  const container = getContainer();
  const scrollTop = getScroll(container);
  const startTime = Date.now();
  let rafId;
  const frameFunc = () => {
    const timestamp = Date.now();
    const time = timestamp - startTime;
    const nextScrollTop = easeInOutCubic(time > duration ? duration : time, scrollTop, y, duration);
    if (isWindow(container)) {
      container.scrollTo(window.pageXOffset, nextScrollTop);
    } else if (isDocument(container)) {
      container.documentElement.scrollTop = nextScrollTop;
    } else {
      container.scrollTop = nextScrollTop;
    }
    if (time < duration) {
      rafId = raf(frameFunc);
    } else if (isFunction(callback)) {
      callback();
    }
  };
  rafId = raf(frameFunc);
  return () => {
    raf.cancel(rafId);
  };
}
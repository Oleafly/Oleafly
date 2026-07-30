import React, { useContext, useRef } from 'react';
import { composeRef, getNodeRef, isVisible, supportRef } from '@rc-component/util';
import { clsx } from 'clsx';
import { ConfigContext } from '../../config-provider';
import { cloneElement } from '../reactNode';
import useStyle from './style';
import useWave from './useWave';
const TRIGGER_TYPE_TO_EVENT_MAP = {
  click: 'click',
  mousedown: 'mousedown',
  mouseup: 'mouseup',
  pointerdown: 'pointerdown',
  pointerup: 'pointerup'
};
const Wave = props => {
  const {
    children,
    disabled,
    component,
    colorSource
  } = props;
  const {
    getPrefixCls,
    wave
  } = useContext(ConfigContext);
  const containerRef = useRef(null);
  // ============================== Style ===============================
  const prefixCls = getPrefixCls('wave');
  const hashId = useStyle(prefixCls);
  // =============================== Wave ===============================
  const showWave = useWave(containerRef, clsx(prefixCls, hashId), component, colorSource);
  // ============================== Effect ==============================
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node || node.nodeType !== window.Node.ELEMENT_NODE || disabled) {
      return;
    }
    const onClick = e => {
      // Fix radio button click twice
      if (!isVisible(e.target) || !node.getAttribute || node.getAttribute('disabled') || node.disabled || node.className.includes('disabled') && !node.className.includes('disabled:') || node.getAttribute('aria-disabled') === 'true' || node.className.includes('-leave')) {
        return;
      }
      showWave(e);
    };
    const triggerType = wave?.triggerType;
    const eventName = triggerType && triggerType in TRIGGER_TYPE_TO_EVENT_MAP ? TRIGGER_TYPE_TO_EVENT_MAP[triggerType] : 'click';
    node.addEventListener(eventName, onClick, true);
    return () => {
      node.removeEventListener(eventName, onClick, true);
    };
  }, [disabled, wave?.triggerType]);
  // ============================== Render ==============================
  if (! /*#__PURE__*/React.isValidElement(children)) {
    return children ?? null;
  }
  const ref = supportRef(children) ? composeRef(getNodeRef(children), containerRef) : containerRef;
  return cloneElement(children, {
    ref
  });
};
if (process.env.NODE_ENV !== 'production') {
  Wave.displayName = 'Wave';
}
export default Wave;
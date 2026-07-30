"use client";

import * as React from 'react';
import { NotificationProvider, useNotification as useRcNotification } from '@rc-component/notification';
import { clsx } from 'clsx';
import { resolveStyleOrClass, useMergeSemantic } from '../_util/hooks/useMergeSemantic';
import { isFunction, isNonNullable, isPlainObject } from '../_util/is';
import { devUseWarning } from '../_util/warning';
import { ConfigContext } from '../config-provider';
import { useComponentConfig } from '../config-provider/context';
import useCSSVarCls from '../config-provider/hooks/useCSSVarCls';
import useStackConfig from '../notification/hooks/useStackConfig';
import { getPlacementOffsetStyle } from '../notification/util';
import { getMessageIcon } from './PurePanel';
import useStyle from './style';
import { getMotion, wrapPromiseFn } from './util';
const DEFAULT_OFFSET = 8;
const DEFAULT_DURATION = 3;
const DEFAULT_STACK_CONFIG = false;
const Wrapper = ({
  children,
  prefixCls
}) => {
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls, rootCls);
  return /*#__PURE__*/React.createElement(NotificationProvider, {
    classNames: {
      list: clsx(hashId, cssVarCls, rootCls)
    }
  }, children);
};
const renderNotifications = (node, {
  prefixCls,
  key
}) => (/*#__PURE__*/React.createElement(Wrapper, {
  prefixCls: prefixCls,
  key: key
}, node));
const Holder = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    // Placement
    top,
    // Config
    prefixCls: staticPrefixCls,
    getContainer: staticGetContainer,
    maxCount,
    duration = DEFAULT_DURATION,
    // Style
    rtl,
    classNames,
    styles,
    // Motion
    transitionName,
    // UI
    pauseOnHover = true,
    stack,
    // Life Cycle
    onAllRemoved
  } = props;
  const {
    getPrefixCls,
    direction,
    getPopupContainer
  } = useComponentConfig('message');
  const {
    message
  } = React.useContext(ConfigContext);
  const prefixCls = staticPrefixCls || getPrefixCls('message');
  // Use useMergeSemantic to merge classNames and styles
  const [mergedClassNames, mergedStyles] = useMergeSemantic([message?.classNames, classNames], [message?.styles, styles], {
    props: props
  });
  // =============================== Style ===============================
  const getStyle = () => getPlacementOffsetStyle(top ?? DEFAULT_OFFSET);
  const getClassName = () => clsx({
    [`${prefixCls}-rtl`]: rtl ?? direction === 'rtl'
  });
  // ============================== Motion ===============================
  const getNotificationMotion = () => getMotion(prefixCls, transitionName);
  // =============================== Stack ===============================
  const stackConfig = useStackConfig(stack, DEFAULT_STACK_CONFIG);
  // ============================== Origin ===============================
  const [api, holder] = useRcNotification({
    prefixCls,
    style: getStyle,
    className: getClassName,
    motion: getNotificationMotion,
    // closable=false requires-no closeIcon
    closable: false,
    duration,
    getContainer: () => staticGetContainer?.() || getPopupContainer?.() || document.body,
    maxCount,
    onAllRemoved,
    classNames: mergedClassNames,
    styles: mergedStyles,
    renderNotifications,
    pauseOnHover,
    stack: stackConfig
  });
  // ================================ Ref ================================
  React.useImperativeHandle(ref, () => ({
    ...api,
    prefixCls,
    message
  }));
  return holder;
});
// ==============================================================================
// ==                                   Hook                                   ==
// ==============================================================================
let keyIndex = 0;
export function useInternalMessage(messageConfig) {
  const holderRef = React.useRef(null);
  const warning = devUseWarning('Message');
  // ================================ API ================================
  const wrapAPI = React.useMemo(() => {
    // Wrap with notification content
    // >>> close
    const close = key => {
      holderRef.current?.close(key);
    };
    // >>> Open
    const open = config => {
      if (!holderRef.current) {
        process.env.NODE_ENV !== "production" ? warning(false, 'usage', 'You are calling notice in render which will break in React 18 concurrent mode. Please trigger in effect instead.') : void 0;
        const fakeResult = () => {};
        fakeResult.then = () => {};
        return fakeResult;
      }
      const {
        open: originOpen,
        prefixCls,
        message
      } = holderRef.current;
      const contextClassName = message?.className || {};
      const contextStyle = message?.style || {};
      const noticePrefixCls = `${prefixCls}-notice`;
      const {
        content,
        icon,
        type,
        key,
        className,
        style,
        onClose,
        classNames: configClassNames = {},
        styles = {},
        ...restConfig
      } = config;
      let mergedKey = key;
      if (!isNonNullable(mergedKey)) {
        keyIndex += 1;
        mergedKey = `antd-message-${keyIndex}`;
      }
      const contextConfig = {
        ...messageConfig,
        ...config
      };
      const semanticClassNames = resolveStyleOrClass(configClassNames, {
        props: contextConfig
      });
      const semanticStyles = resolveStyleOrClass(styles, {
        props: contextConfig
      });
      const iconNode = getMessageIcon(type, icon);
      const typeIconCls = type ? `${noticePrefixCls}-icon-${type}` : undefined;
      return wrapPromiseFn(resolve => {
        originOpen({
          ...restConfig,
          key: mergedKey,
          icon: iconNode,
          title: content,
          classNames: {
            ...semanticClassNames,
            wrapper: clsx(type && `${prefixCls}-${type}`, semanticClassNames?.wrapper),
            icon: clsx(typeIconCls, semanticClassNames?.icon)
          },
          styles: semanticStyles,
          placement: 'top',
          className: clsx({
            [`${noticePrefixCls}-${type}`]: type
          }, className, contextClassName),
          style: {
            ...contextStyle,
            ...style
          },
          onClose: () => {
            onClose?.();
            resolve();
          }
        });
        // Return close function
        return () => {
          close(mergedKey);
        };
      });
    };
    // >>> destroy
    const destroy = key => {
      if (key !== undefined) {
        close(key);
      } else {
        holderRef.current?.destroy();
      }
    };
    const clone = {
      open,
      destroy
    };
    const keys = ['info', 'success', 'warning', 'error', 'loading'];
    keys.forEach(type => {
      const typeOpen = (jointContent, duration, onClose) => {
        let config;
        if (isPlainObject(jointContent) && 'content' in jointContent) {
          config = jointContent;
        } else {
          config = {
            content: jointContent
          };
        }
        // Params
        let mergedDuration;
        let mergedOnClose;
        if (isFunction(duration)) {
          mergedOnClose = duration;
        } else {
          mergedDuration = duration;
          mergedOnClose = onClose;
        }
        const mergedConfig = {
          onClose: mergedOnClose,
          duration: mergedDuration,
          ...config,
          type
        };
        return open(mergedConfig);
      };
      clone[type] = typeOpen;
    });
    return clone;
  }, []);
  // ============================== Return ===============================
  return [wrapAPI, /*#__PURE__*/React.createElement(Holder, {
    key: "message-holder",
    ...messageConfig,
    ref: holderRef
  })];
}
export default function useMessage(messageConfig) {
  return useInternalMessage(messageConfig);
}
import { useEvent } from '@rc-component/util';
import * as React from 'react';
import Notifications from "../Notifications";
const defaultGetContainer = () => document.body;

// ========================= Types ==========================

// ======================== Helper ==========================
let uniqueKey = 0;
function mergeConfig(...objList) {
  const clone = {};
  objList.forEach(obj => {
    if (obj) {
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        if (value !== undefined) {
          clone[key] = value;
        }
      });
    }
  });
  return clone;
}

/**
 * Creates the notification API and the React holder element.
 * Queueing is handled internally until the notification instance is ready.
 */
export default function useNotification(rootConfig = {}) {
  // ========================= Config =========================
  const {
    getContainer = defaultGetContainer,
    motion,
    prefixCls,
    placement,
    closable,
    duration,
    showProgress,
    pauseOnHover,
    classNames,
    styles,
    components,
    maxCount,
    className,
    style,
    onAllRemoved,
    stack,
    renderNotifications
  } = rootConfig;
  const shareConfig = {
    placement,
    closable,
    duration,
    showProgress
  };

  // ========================= Holder =========================
  const [container, setContainer] = React.useState();
  const notificationsRef = React.useRef(null);
  const [taskQueue, setTaskQueue] = React.useState([]);
  const contextHolder = /*#__PURE__*/React.createElement(Notifications, {
    container: container,
    ref: notificationsRef,
    prefixCls: prefixCls,
    motion: motion,
    maxCount: maxCount,
    pauseOnHover: pauseOnHover,
    classNames: classNames,
    styles: styles,
    components: components,
    className: className,
    style: style,
    onAllRemoved: onAllRemoved,
    stack: stack,
    renderNotifications: renderNotifications
  });

  // ========================== API ==========================
  const open = useEvent(config => {
    const mergedConfig = mergeConfig(shareConfig, config);
    if (mergedConfig.key === null || mergedConfig.key === undefined) {
      mergedConfig.key = `rc-notification-${uniqueKey}`;
      uniqueKey += 1;
    }
    setTaskQueue(queue => [...queue, {
      type: 'open',
      config: mergedConfig
    }]);
  });
  const api = React.useMemo(() => ({
    open,
    close: key => {
      setTaskQueue(queue => [...queue, {
        type: 'close',
        key
      }]);
    },
    destroy: () => {
      setTaskQueue(queue => [...queue, {
        type: 'destroy'
      }]);
    }
  }), []);

  // ======================== Effect =========================
  // React 18 should all in effect that we will check container in each render
  // Which means getContainer should be stable.
  React.useEffect(() => {
    setContainer(getContainer());
  });
  React.useEffect(() => {
    // Flush task when node ready
    if (notificationsRef.current && taskQueue.length) {
      taskQueue.forEach(task => {
        switch (task.type) {
          case 'open':
            notificationsRef.current?.open(task.config);
            break;
          case 'close':
            notificationsRef.current?.close(task.key);
            break;
          case 'destroy':
            notificationsRef.current?.destroy();
            break;
        }
      });
      setTaskQueue(originQueue => {
        const targetTaskQueue = originQueue.filter(task => !taskQueue.includes(task));
        return targetTaskQueue.length === originQueue.length ? originQueue : targetTaskQueue;
      });
    }
  }, [taskQueue]);

  // ======================== Return =========================
  return [api, contextHolder];
}
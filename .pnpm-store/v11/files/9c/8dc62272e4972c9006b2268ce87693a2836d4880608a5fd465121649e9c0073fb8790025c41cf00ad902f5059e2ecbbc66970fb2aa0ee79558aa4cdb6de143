import * as React from 'react';
import { createPortal } from 'react-dom';
import { useEvent } from '@rc-component/util';
import NotificationList from "./NotificationList";

// ========================= Types ==========================

const Notifications = /*#__PURE__*/React.forwardRef((props, ref) => {
  // ========================= Props ==========================
  const {
    prefixCls = 'rc-notification',
    container,
    motion,
    maxCount,
    pauseOnHover,
    classNames,
    styles,
    components,
    className,
    style,
    onAllRemoved,
    stack,
    renderNotifications
  } = props;

  // ========================= State ==========================
  const [configList, setConfigList] = React.useState([]);
  const [placements, setPlacements] = React.useState({});
  const emptyRef = React.useRef(false);

  // ========================== Ref ===========================
  React.useImperativeHandle(ref, () => ({
    open: config => {
      setConfigList(list => {
        let clone = [...list];
        const index = clone.findIndex(item => item.key === config.key);
        const innerConfig = {
          ...config
        };
        if (index >= 0) {
          innerConfig.times = (list[index]?.times ?? 0) + 1;
          clone[index] = innerConfig;
        } else {
          innerConfig.times = 0;
          clone.push(innerConfig);
        }
        if (maxCount && maxCount > 0 && clone.length > maxCount) {
          clone = clone.slice(-maxCount);
        }
        return clone;
      });
    },
    close: key => {
      setConfigList(list => list.filter(item => item.key !== key));
    },
    destroy: () => {
      setConfigList([]);
    }
  }));

  // ======================== Effect =========================
  React.useEffect(() => {
    const nextPlacements = {};
    configList.forEach(config => {
      const placement = config.placement ?? 'topRight';
      nextPlacements[placement] = nextPlacements[placement] || [];
      nextPlacements[placement].push(config);
    });
    Object.keys(placements).forEach(placement => {
      nextPlacements[placement] = nextPlacements[placement] || [];
    });
    setPlacements(nextPlacements);
  }, [configList]);

  // ======================== Callback =======================
  const onAllNoticeRemoved = useEvent(placement => {
    setPlacements(originPlacements => {
      const clone = {
        ...originPlacements
      };
      if (!(clone[placement] || []).length) {
        delete clone[placement];
      }
      return clone;
    });
  });

  // ======================== Effect =========================
  React.useEffect(() => {
    if (Object.keys(placements).length > 0) {
      emptyRef.current = true;
    } else if (emptyRef.current) {
      onAllRemoved?.();
      emptyRef.current = false;
    }
  }, [placements, onAllRemoved]);

  // ======================== Render =========================
  if (!container) {
    return null;
  }
  const placementList = Object.keys(placements);
  return /*#__PURE__*/createPortal( /*#__PURE__*/React.createElement(React.Fragment, null, placementList.map(placement => {
    const list = /*#__PURE__*/React.createElement(NotificationList, {
      key: placement,
      configList: placements[placement],
      placement: placement,
      prefixCls: prefixCls,
      pauseOnHover: pauseOnHover,
      classNames: classNames,
      styles: styles,
      components: components,
      className: className?.(placement),
      style: style?.(placement),
      motion: motion,
      stack: stack,
      onNoticeClose: key => {
        setConfigList(oriList => oriList.filter(item => item.key !== key));
      },
      onAllRemoved: onAllNoticeRemoved
    });
    return renderNotifications ? /*#__PURE__*/React.cloneElement(renderNotifications(list, {
      prefixCls,
      key: placement
    }), {
      key: placement
    }) : list;
  })), container);
});
if (process.env.NODE_ENV !== 'production') {
  Notifications.displayName = 'Notifications';
}
export default Notifications;
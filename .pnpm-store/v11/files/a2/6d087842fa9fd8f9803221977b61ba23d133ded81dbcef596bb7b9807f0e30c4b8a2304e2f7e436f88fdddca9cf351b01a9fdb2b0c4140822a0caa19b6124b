"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _reactDom = require("react-dom");
var _util = require("@rc-component/util");
var _NotificationList = _interopRequireDefault(require("./NotificationList"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
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
  const onAllNoticeRemoved = (0, _util.useEvent)(placement => {
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
  return /*#__PURE__*/(0, _reactDom.createPortal)( /*#__PURE__*/React.createElement(React.Fragment, null, placementList.map(placement => {
    const list = /*#__PURE__*/React.createElement(_NotificationList.default, {
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
var _default = exports.default = Notifications;
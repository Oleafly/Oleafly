"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = MultipleDates;
var _clsx = require("clsx");
var _overflow = _interopRequireDefault(require("@rc-component/overflow"));
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function MultipleDates(props) {
  const {
    prefixCls,
    value,
    onRemove,
    removeIcon = '×',
    formatDate,
    disabled,
    maxTagCount,
    tagRender,
    placeholder
  } = props;
  const selectorCls = `${prefixCls}-selector`;
  const selectionCls = `${prefixCls}-selection`;
  const overflowCls = `${selectionCls}-overflow`;

  // ========================= Item =========================
  function renderSelector(content, onClose) {
    return /*#__PURE__*/React.createElement("span", {
      className: (0, _clsx.clsx)(`${selectionCls}-item`),
      title: typeof content === 'string' ? content : null
    }, /*#__PURE__*/React.createElement("span", {
      className: `${selectionCls}-item-content`
    }, content), !disabled && onClose && /*#__PURE__*/React.createElement("span", {
      onMouseDown: e => {
        e.preventDefault();
      },
      onClick: onClose,
      className: `${selectionCls}-item-remove`
    }, removeIcon));
  }
  function renderItem(date) {
    const displayLabel = formatDate(date);
    const closable = !disabled;
    const onClose = event => {
      if (event) event.stopPropagation();
      if (!disabled) {
        onRemove(date);
      }
    };
    if (tagRender) {
      return tagRender({
        label: displayLabel,
        value: date,
        disabled: !!disabled,
        closable,
        onClose
      });
    }
    return renderSelector(displayLabel, onClose);
  }

  // ========================= Rest =========================
  function renderRest(omittedValues) {
    const content = `+ ${omittedValues.length} ...`;
    return renderSelector(content);
  }

  // ======================== Render ========================

  return /*#__PURE__*/React.createElement("div", {
    className: selectorCls
  }, /*#__PURE__*/React.createElement(_overflow.default, {
    prefixCls: overflowCls,
    data: value,
    renderItem: renderItem,
    renderRest: renderRest
    // suffix={inputNode}
    ,
    itemKey: date => formatDate(date),
    maxCount: maxTagCount
  }), !value.length && /*#__PURE__*/React.createElement("span", {
    className: `${prefixCls}-selection-placeholder`
  }, placeholder));
}
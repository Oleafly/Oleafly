"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = PanelBody;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../utils/dateUtil");
var _context = require("./context");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function PanelBody(props) {
  const {
    rowNum,
    colNum,
    baseDate,
    getCellDate,
    prefixColumn,
    rowClassName,
    titleFormat,
    getCellText,
    getCellClassName,
    headerCells,
    cellSelection = true,
    disabledDate
  } = props;
  const {
    prefixCls,
    classNames,
    styles,
    panelType: type,
    now,
    disabledDate: contextDisabledDate,
    cellRender,
    onHover,
    hoverValue,
    hoverRangeValue,
    generateConfig,
    values,
    locale,
    onSelect
  } = (0, _context.usePanelContext)();
  const mergedDisabledDate = disabledDate || contextDisabledDate;
  const cellPrefixCls = `${prefixCls}-cell`;

  // ============================= Context ==============================
  const {
    onCellDblClick
  } = React.useContext(_context.PickerHackContext);

  // ============================== Value ===============================
  const matchValues = date => values.some(singleValue => singleValue && (0, _dateUtil.isSame)(generateConfig, locale, date, singleValue, type));

  // =============================== Body ===============================
  const rows = [];
  for (let row = 0; row < rowNum; row += 1) {
    const rowNode = [];
    let rowStartDate;
    for (let col = 0; col < colNum; col += 1) {
      const offset = row * colNum + col;
      const currentDate = getCellDate(baseDate, offset);
      const disabled = mergedDisabledDate?.(currentDate, {
        type: type
      });

      // Row Start Cell
      if (col === 0) {
        rowStartDate = currentDate;
        if (prefixColumn) {
          rowNode.push(prefixColumn(rowStartDate));
        }
      }

      // Range
      let inRange = false;
      let rangeStart = false;
      let rangeEnd = false;
      if (cellSelection && hoverRangeValue) {
        const [hoverStart, hoverEnd] = hoverRangeValue;
        inRange = (0, _dateUtil.isInRange)(generateConfig, hoverStart, hoverEnd, currentDate);
        rangeStart = (0, _dateUtil.isSame)(generateConfig, locale, currentDate, hoverStart, type);
        rangeEnd = (0, _dateUtil.isSame)(generateConfig, locale, currentDate, hoverEnd, type);
      }

      // Title
      const title = titleFormat ? (0, _dateUtil.formatValue)(currentDate, {
        locale,
        format: titleFormat,
        generateConfig
      }) : undefined;

      // Render
      const inner = /*#__PURE__*/React.createElement("div", {
        className: `${cellPrefixCls}-inner`
      }, getCellText(currentDate));
      rowNode.push( /*#__PURE__*/React.createElement("td", {
        key: col,
        title: title,
        className: (0, _clsx.clsx)(cellPrefixCls, classNames.item, {
          [`${cellPrefixCls}-disabled`]: disabled,
          [`${cellPrefixCls}-hover`]: (hoverValue || []).some(date => (0, _dateUtil.isSame)(generateConfig, locale, currentDate, date, type)),
          [`${cellPrefixCls}-in-range`]: inRange && !rangeStart && !rangeEnd,
          [`${cellPrefixCls}-range-start`]: rangeStart,
          [`${cellPrefixCls}-range-end`]: rangeEnd,
          [`${prefixCls}-cell-selected`]: !hoverRangeValue &&
          // WeekPicker use row instead
          type !== 'week' && matchValues(currentDate),
          ...getCellClassName(currentDate)
        }),
        style: styles.item,
        onClick: () => {
          if (!disabled) {
            onSelect(currentDate);
          }
        },
        onDoubleClick: () => {
          if (!disabled && onCellDblClick) {
            onCellDblClick();
          }
        },
        onMouseEnter: () => {
          if (!disabled) {
            onHover?.(currentDate);
          }
        },
        onMouseLeave: () => {
          if (!disabled) {
            onHover?.(null);
          }
        }
      }, cellRender ? cellRender(currentDate, {
        prefixCls,
        originNode: inner,
        today: now,
        type: type,
        locale
      }) : inner));
    }
    rows.push( /*#__PURE__*/React.createElement("tr", {
      key: row,
      className: rowClassName?.(rowStartDate)
    }, rowNode));
  }

  // ============================== Render ==============================
  return /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${prefixCls}-body`, classNames.body),
    style: styles.body
  }, /*#__PURE__*/React.createElement("table", {
    className: (0, _clsx.clsx)(`${prefixCls}-content`, classNames.content),
    style: styles.content
  }, headerCells && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, headerCells)), /*#__PURE__*/React.createElement("tbody", null, rows)));
}
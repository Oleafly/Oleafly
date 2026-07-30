import { clsx } from 'clsx';
import * as React from 'react';
import { formatValue, isInRange, isSame } from "../utils/dateUtil";
import { PickerHackContext, usePanelContext } from "./context";
export default function PanelBody(props) {
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
  } = usePanelContext();
  const mergedDisabledDate = disabledDate || contextDisabledDate;
  const cellPrefixCls = `${prefixCls}-cell`;

  // ============================= Context ==============================
  const {
    onCellDblClick
  } = React.useContext(PickerHackContext);

  // ============================== Value ===============================
  const matchValues = date => values.some(singleValue => singleValue && isSame(generateConfig, locale, date, singleValue, type));

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
        inRange = isInRange(generateConfig, hoverStart, hoverEnd, currentDate);
        rangeStart = isSame(generateConfig, locale, currentDate, hoverStart, type);
        rangeEnd = isSame(generateConfig, locale, currentDate, hoverEnd, type);
      }

      // Title
      const title = titleFormat ? formatValue(currentDate, {
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
        className: clsx(cellPrefixCls, classNames.item, {
          [`${cellPrefixCls}-disabled`]: disabled,
          [`${cellPrefixCls}-hover`]: (hoverValue || []).some(date => isSame(generateConfig, locale, currentDate, date, type)),
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
    className: clsx(`${prefixCls}-body`, classNames.body),
    style: styles.body
  }, /*#__PURE__*/React.createElement("table", {
    className: clsx(`${prefixCls}-content`, classNames.content),
    style: styles.content
  }, headerCells && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, headerCells)), /*#__PURE__*/React.createElement("tbody", null, rows)));
}
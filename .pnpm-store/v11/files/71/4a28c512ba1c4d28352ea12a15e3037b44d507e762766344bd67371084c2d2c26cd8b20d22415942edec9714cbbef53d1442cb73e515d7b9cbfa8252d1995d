"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _table = require("@rc-component/table");
var _util = require("@rc-component/util");
var _useSelection = require("./useSelection");
const useFilledColumns = (columns, column) => React.useMemo(() => {
  if (!column) {
    return columns;
  }
  const fillColumns = currentColumns => currentColumns.map(col => {
    if (col === _useSelection.SELECTION_COLUMN || col === _table.EXPAND_COLUMN) {
      return col;
    }
    if ('children' in col && Array.isArray(col.children)) {
      const mergedColumn = (0, _util.mergeProps)(column, col);
      return {
        ...mergedColumn,
        children: fillColumns(col.children)
      };
    }
    const columnWithoutChildren = (0, _util.omit)(column, ['children']);
    return (0, _util.mergeProps)(columnWithoutChildren, col);
  });
  return fillColumns(columns);
}, [columns, column]);
var _default = exports.default = useFilledColumns;
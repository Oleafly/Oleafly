"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
var _is = require("../../_util/is");
const getMergedFilters = filters => {
  const mergedFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if ((0, _is.isNonNullable)(value)) {
      mergedFilters[key] = value;
    }
  }
  return mergedFilters;
};
const useColumnTitleProps = (sorterTitleProps, filters) => {
  const columnTitleProps = _react.default.useMemo(() => {
    return {
      ...sorterTitleProps,
      filters: getMergedFilters(filters)
    };
  }, [sorterTitleProps, filters]);
  return columnTitleProps;
};
var _default = exports.default = useColumnTitleProps;
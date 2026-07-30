"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getColumnKey = void 0;
exports.getColumnPos = getColumnPos;
exports.safeColumnTitle = exports.renderColumnTitle = exports.normalizePlacement = exports.getPaginationSize = void 0;
var _is = require("../_util/is");
const getColumnKey = (column, defaultKey) => {
  if ('key' in column && (0, _is.isNonNullable)(column.key)) {
    return column.key;
  }
  if (column.dataIndex) {
    return Array.isArray(column.dataIndex) ? column.dataIndex.join('.') : column.dataIndex;
  }
  return defaultKey;
};
exports.getColumnKey = getColumnKey;
function getColumnPos(index, pos) {
  return pos ? `${pos}-${index}` : `${index}`;
}
const renderColumnTitle = (title, props) => {
  if ((0, _is.isFunction)(title)) {
    return title(props);
  }
  return title;
};
/**
 * @description Safe get column title, Should filter object
 * @param title
 */
exports.renderColumnTitle = renderColumnTitle;
const safeColumnTitle = (title, props) => {
  const result = renderColumnTitle(title, props);
  if ((0, _is.isPlainObject)(result) || Array.isArray(result)) {
    return '';
  }
  return result;
};
exports.safeColumnTitle = safeColumnTitle;
const normalizePlacement = pos => {
  const lowerPos = pos.toLowerCase();
  if (lowerPos.includes('center')) {
    return 'center';
  }
  return lowerPos.includes('left') || lowerPos.includes('start') ? 'start' : 'end';
};
exports.normalizePlacement = normalizePlacement;
const getPaginationSize = (paginationSize, mergedSize) => {
  if (paginationSize) {
    return paginationSize;
  }
  if (mergedSize === 'small' || mergedSize === 'medium') {
    return 'small';
  }
  return undefined;
};
exports.getPaginationSize = getPaginationSize;
"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getSortData = exports.default = void 0;
var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));
var React = _interopRequireWildcard(require("react"));
var _CaretDownOutlined = _interopRequireDefault(require("@ant-design/icons/CaretDownOutlined"));
var _CaretUpOutlined = _interopRequireDefault(require("@ant-design/icons/CaretUpOutlined"));
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _is = require("../../_util/is");
var _tooltip = _interopRequireDefault(require("../../tooltip"));
var _util2 = require("../util");
const ASCEND = 'ascend';
const DESCEND = 'descend';
const getMultiplePriority = column => {
  if ((0, _is.isPlainObject)(column.sorter) && (0, _is.isNumber)(column.sorter.multiple)) {
    return column.sorter.multiple;
  }
  return false;
};
const getSortFunction = sorter => {
  if ((0, _is.isFunction)(sorter)) {
    return sorter;
  }
  if ((0, _is.isPlainObject)(sorter) && sorter.compare) {
    return sorter.compare;
  }
  return false;
};
const nextSortDirection = (sortDirections, current) => {
  if (!current) {
    return sortDirections[0];
  }
  return sortDirections[sortDirections.indexOf(current) + 1];
};
const collectSortStates = (columns, init, pos) => {
  let sortStates = [];
  const pushState = (column, columnPos) => {
    sortStates.push({
      column,
      key: (0, _util2.getColumnKey)(column, columnPos),
      multiplePriority: getMultiplePriority(column),
      sortOrder: column.sortOrder
    });
  };
  (columns || []).forEach((column, index) => {
    const columnPos = (0, _util2.getColumnPos)(index, pos);
    if (column.children) {
      if ('sortOrder' in column) {
        // Controlled
        pushState(column, columnPos);
      }
      sortStates = [].concat((0, _toConsumableArray2.default)(sortStates), (0, _toConsumableArray2.default)(collectSortStates(column.children, init, columnPos)));
    } else if (column.sorter) {
      if ('sortOrder' in column) {
        // Controlled
        pushState(column, columnPos);
      } else if (init && column.defaultSortOrder) {
        // Default sorter
        sortStates.push({
          column,
          key: (0, _util2.getColumnKey)(column, columnPos),
          multiplePriority: getMultiplePriority(column),
          sortOrder: column.defaultSortOrder
        });
      }
    }
  });
  return sortStates;
};
const injectSorter = (prefixCls, columns, sorterStates, triggerSorter, defaultSortDirections, tableLocale, tableShowSorterTooltip, pos, a11yLocale) => {
  const finalColumns = (columns || []).map((column, index) => {
    const columnPos = (0, _util2.getColumnPos)(index, pos);
    let newColumn = column;
    if (newColumn.sorter) {
      const sortDirections = newColumn.sortDirections || defaultSortDirections;
      const showSorterTooltip = newColumn.showSorterTooltip === undefined ? tableShowSorterTooltip : newColumn.showSorterTooltip;
      const columnKey = (0, _util2.getColumnKey)(newColumn, columnPos);
      const sorterState = sorterStates.find(({
        key
      }) => key === columnKey);
      const sortOrder = sorterState ? sorterState.sortOrder : null;
      const nextSortOrder = nextSortDirection(sortDirections, sortOrder);
      let sorter;
      if (column.sortIcon) {
        sorter = column.sortIcon({
          sortOrder
        });
      } else {
        const upNode = sortDirections.includes(ASCEND) && (/*#__PURE__*/React.createElement(_CaretUpOutlined.default, {
          className: (0, _clsx.clsx)(`${prefixCls}-column-sorter-up`, {
            active: sortOrder === ASCEND
          })
        }));
        const downNode = sortDirections.includes(DESCEND) && (/*#__PURE__*/React.createElement(_CaretDownOutlined.default, {
          className: (0, _clsx.clsx)(`${prefixCls}-column-sorter-down`, {
            active: sortOrder === DESCEND
          })
        }));
        sorter = /*#__PURE__*/React.createElement("span", {
          className: (0, _clsx.clsx)(`${prefixCls}-column-sorter`, {
            [`${prefixCls}-column-sorter-full`]: !!(upNode && downNode)
          })
        }, /*#__PURE__*/React.createElement("span", {
          className: `${prefixCls}-column-sorter-inner`,
          "aria-hidden": "true"
        }, upNode, downNode));
      }
      const {
        cancelSort,
        triggerAsc,
        triggerDesc
      } = tableLocale || {};
      let sortTip = cancelSort;
      if (nextSortOrder === DESCEND) {
        sortTip = triggerDesc;
      } else if (nextSortOrder === ASCEND) {
        sortTip = triggerAsc;
      }
      const tooltipProps = (0, _is.isPlainObject)(showSorterTooltip) ? {
        title: sortTip,
        ...showSorterTooltip
      } : {
        title: sortTip
      };
      newColumn = {
        ...newColumn,
        className: (0, _clsx.clsx)(newColumn.className, {
          [`${prefixCls}-column-sort`]: sortOrder
        }),
        title: renderProps => {
          const columnSortersClass = `${prefixCls}-column-sorters`;
          const renderColumnTitleWrapper = /*#__PURE__*/React.createElement("span", {
            className: `${prefixCls}-column-title`
          }, (0, _util2.renderColumnTitle)(column.title, renderProps));
          const renderSortTitle = /*#__PURE__*/React.createElement("div", {
            className: columnSortersClass
          }, renderColumnTitleWrapper, sorter);
          if (showSorterTooltip) {
            if (typeof showSorterTooltip !== 'boolean' && showSorterTooltip?.target === 'sorter-icon') {
              return /*#__PURE__*/React.createElement("div", {
                className: (0, _clsx.clsx)(columnSortersClass, `${columnSortersClass}-tooltip-target-sorter`)
              }, renderColumnTitleWrapper, /*#__PURE__*/React.createElement(_tooltip.default, {
                ...tooltipProps
              }, sorter));
            }
            return /*#__PURE__*/React.createElement(_tooltip.default, {
              ...tooltipProps
            }, renderSortTitle);
          }
          return renderSortTitle;
        },
        onHeaderCell: col => {
          const cell = column.onHeaderCell?.(col) || {};
          const originOnClick = cell.onClick;
          const originOKeyDown = cell.onKeyDown;
          cell.onClick = event => {
            triggerSorter({
              column,
              key: columnKey,
              sortOrder: nextSortOrder,
              multiplePriority: getMultiplePriority(column)
            });
            originOnClick?.(event);
          };
          cell.onKeyDown = event => {
            if (event.keyCode === _util.KeyCode.ENTER) {
              triggerSorter({
                column,
                key: columnKey,
                sortOrder: nextSortOrder,
                multiplePriority: getMultiplePriority(column)
              });
              originOKeyDown?.(event);
            }
          };
          const renderTitle = (0, _util2.safeColumnTitle)(column.title, {});
          const displayTitle = renderTitle?.toString();
          // Inform the screen-reader so it can tell the visually impaired user which column is sorted
          if (sortOrder) {
            cell['aria-sort'] = sortOrder === 'ascend' ? 'ascending' : 'descending';
          }
          // Inform the screen-reader so it can tell the visually impaired user that this column can be sorted
          cell['aria-description'] = a11yLocale?.sortable;
          cell['aria-label'] = displayTitle || '';
          cell.className = (0, _clsx.clsx)(cell.className, `${prefixCls}-column-has-sorters`);
          cell.tabIndex = 0;
          if (column.ellipsis) {
            cell.title = (renderTitle ?? '').toString();
          }
          return cell;
        }
      };
    }
    if ('children' in newColumn) {
      newColumn = {
        ...newColumn,
        children: injectSorter(prefixCls, newColumn.children, sorterStates, triggerSorter, defaultSortDirections, tableLocale, tableShowSorterTooltip, columnPos, a11yLocale)
      };
    }
    return newColumn;
  });
  return finalColumns;
};
const stateToInfo = sorterState => {
  const {
    column,
    sortOrder
  } = sorterState;
  return {
    column,
    order: sortOrder,
    field: column.dataIndex,
    columnKey: column.key
  };
};
const generateSorterInfo = sorterStates => {
  const activeSorters = sorterStates.reduce((list, sorterState) => {
    if (sorterState.sortOrder) {
      list.push(stateToInfo(sorterState));
    }
    return list;
  }, []);
  // =========== Legacy compatible support ===========
  // https://github.com/ant-design/ant-design/pull/19226
  if (activeSorters.length === 0 && sorterStates.length) {
    const lastIndex = sorterStates.length - 1;
    return {
      ...stateToInfo(sorterStates[lastIndex]),
      column: undefined,
      order: undefined,
      field: undefined,
      columnKey: undefined
    };
  }
  if (activeSorters.length <= 1) {
    return activeSorters[0] || {};
  }
  return activeSorters;
};
const getSortData = (data, sortStates, childrenColumnName) => {
  const innerSorterStates = sortStates.slice().sort((a, b) => b.multiplePriority - a.multiplePriority);
  const cloneData = data.slice();
  const runningSorters = innerSorterStates.filter(({
    column: {
      sorter
    },
    sortOrder
  }) => getSortFunction(sorter) && sortOrder);
  // Skip if no sorter needed
  if (!runningSorters.length) {
    return cloneData;
  }
  return cloneData.sort((record1, record2) => {
    for (let i = 0; i < runningSorters.length; i += 1) {
      const sorterState = runningSorters[i];
      const {
        column: {
          sorter
        },
        sortOrder
      } = sorterState;
      const compareFn = getSortFunction(sorter);
      if (compareFn && sortOrder) {
        const compareResult = compareFn(record1, record2, sortOrder);
        if (compareResult !== 0) {
          return sortOrder === ASCEND ? compareResult : -compareResult;
        }
      }
    }
    return 0;
  }).map(record => {
    const subRecords = record[childrenColumnName];
    if (subRecords) {
      return {
        ...record,
        [childrenColumnName]: getSortData(subRecords, sortStates, childrenColumnName)
      };
    }
    return record;
  });
};
exports.getSortData = getSortData;
const useFilterSorter = props => {
  const {
    prefixCls,
    mergedColumns,
    baseColumns,
    sortDirections,
    tableLocale,
    showSorterTooltip,
    onSorterChange,
    globalLocale
  } = props;
  // Use base (pre-responsive) columns to seed sort states so that
  // `defaultSortOrder` on a `responsive` column is honored even when the
  // column is not visible at the current breakpoint.
  // See: https://github.com/ant-design/ant-design/issues/32847
  const collectColumns = baseColumns ?? mergedColumns;
  const [sortStates, setSortStates] = React.useState(() => collectSortStates(collectColumns, true));
  const getColumnKeys = (columns, pos) => {
    const newKeys = [];
    columns.forEach((item, index) => {
      const columnPos = (0, _util2.getColumnPos)(index, pos);
      newKeys.push((0, _util2.getColumnKey)(item, columnPos));
      if (Array.isArray(item.children)) {
        const childKeys = getColumnKeys(item.children, columnPos);
        newKeys.push.apply(newKeys, (0, _toConsumableArray2.default)(childKeys));
      }
    });
    return newKeys;
  };
  const mergedSorterStates = React.useMemo(() => {
    let validate = true;
    // Collect controlled `sortOrder` from the full (pre-responsive) column
    // set so that a controlled `sortOrder` on a hidden responsive column
    // still applies to the sorted data.
    const collectedStates = collectSortStates(collectColumns, false);
    // Return if not controlled
    if (!collectedStates.length) {
      const collectColumnsKeys = getColumnKeys(collectColumns);
      return sortStates.filter(({
        key
      }) => collectColumnsKeys.includes(key));
    }
    const validateStates = [];
    function patchStates(state) {
      if (validate) {
        validateStates.push(state);
      } else {
        validateStates.push({
          ...state,
          sortOrder: null
        });
      }
    }
    let multipleMode = null;
    collectedStates.forEach(state => {
      if (multipleMode === null) {
        patchStates(state);
        if (state.sortOrder) {
          if (state.multiplePriority === false) {
            validate = false;
          } else {
            multipleMode = true;
          }
        }
      } else if (multipleMode && state.multiplePriority !== false) {
        patchStates(state);
      } else {
        validate = false;
        patchStates(state);
      }
    });
    return validateStates;
  }, [collectColumns, sortStates]);
  // Get render columns title required props
  const columnTitleSorterProps = React.useMemo(() => {
    const sortColumns = mergedSorterStates.map(({
      column,
      sortOrder
    }) => ({
      column,
      order: sortOrder
    }));
    return {
      sortColumns,
      // Legacy
      sortColumn: sortColumns[0]?.column,
      sortOrder: sortColumns[0]?.order
    };
  }, [mergedSorterStates]);
  const triggerSorter = sortState => {
    let newSorterStates;
    if (sortState.multiplePriority === false || !mergedSorterStates.length || mergedSorterStates[0].multiplePriority === false) {
      newSorterStates = [sortState];
    } else {
      newSorterStates = [].concat((0, _toConsumableArray2.default)(mergedSorterStates.filter(({
        key
      }) => key !== sortState.key)), [sortState]);
    }
    setSortStates(newSorterStates);
    onSorterChange(generateSorterInfo(newSorterStates), newSorterStates);
  };
  const transformColumns = innerColumns => injectSorter(prefixCls, innerColumns, mergedSorterStates, triggerSorter, sortDirections, tableLocale, showSorterTooltip, undefined, globalLocale);
  const getSorters = () => generateSorterInfo(mergedSorterStates);
  return [transformColumns, mergedSorterStates, columnTitleSorterProps, getSorters];
};
var _default = exports.default = useFilterSorter;
"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _table = require("@rc-component/table");
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var _hooks = require("../_util/hooks");
var _useMergeSemantic = require("../_util/hooks/useMergeSemantic");
var _is = require("../_util/is");
var _scrollTo = _interopRequireDefault(require("../_util/scrollTo"));
var _warning = require("../_util/warning");
var _configProvider = _interopRequireDefault(require("../config-provider"));
var _context = require("../config-provider/context");
var _defaultRenderEmpty = _interopRequireDefault(require("../config-provider/defaultRenderEmpty"));
var _useCSSVarCls = _interopRequireDefault(require("../config-provider/hooks/useCSSVarCls"));
var _useSize = _interopRequireDefault(require("../config-provider/hooks/useSize"));
var _useBreakpoint = _interopRequireDefault(require("../grid/hooks/useBreakpoint"));
var _locale = require("../locale");
var _en_US = _interopRequireDefault(require("../locale/en_US"));
var _pagination = _interopRequireDefault(require("../pagination"));
var _spin = _interopRequireDefault(require("../spin"));
var _internal = require("../theme/internal");
var _ExpandIcon = _interopRequireDefault(require("./ExpandIcon"));
var _useColumnTitleProps = _interopRequireDefault(require("./hooks/useColumnTitleProps"));
var _useContainerWidth = _interopRequireDefault(require("./hooks/useContainerWidth"));
var _useFilledColumns = _interopRequireDefault(require("./hooks/useFilledColumns"));
var _useFilter = _interopRequireWildcard(require("./hooks/useFilter"));
var _useLazyKVMap = _interopRequireDefault(require("./hooks/useLazyKVMap"));
var _usePagination = _interopRequireWildcard(require("./hooks/usePagination"));
var _useSelection = _interopRequireDefault(require("./hooks/useSelection"));
var _useSorter = _interopRequireWildcard(require("./hooks/useSorter"));
var _useSpinProps = _interopRequireDefault(require("./hooks/useSpinProps"));
var _useTitleColumns = _interopRequireDefault(require("./hooks/useTitleColumns"));
var _RcTable = _interopRequireDefault(require("./RcTable"));
var _VirtualTable = _interopRequireDefault(require("./RcTable/VirtualTable"));
var _style = _interopRequireDefault(require("./style"));
var _TableMeasureRowContext = _interopRequireDefault(require("./TableMeasureRowContext"));
var _util2 = require("./util");
const EMPTY_LIST = [];
const HeaderTableContext = /*#__PURE__*/React.createContext({});
const HeaderTable = props => {
  const {
    ariaProps,
    component = 'table'
  } = React.useContext(HeaderTableContext);
  return /*#__PURE__*/React.createElement(component, {
    ...ariaProps,
    ...props
  });
};
if (process.env.NODE_ENV !== 'production') {
  HeaderTable.displayName = 'HeaderTable';
}
const InternalTable = (props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    style,
    classNames,
    styles,
    size: customizeSize,
    bordered,
    dropdownPrefixCls: customizeDropdownPrefixCls,
    dataSource,
    pagination,
    rowSelection: customizeRowSelection,
    rowKey: customizeRowKey,
    rowClassName,
    column,
    columns,
    children,
    childrenColumnName: legacyChildrenColumnName,
    onChange,
    getPopupContainer,
    loading,
    expandIcon,
    expandable,
    expandedRowRender,
    expandIconColumnIndex,
    indentSize,
    scroll,
    sortDirections,
    locale,
    showSorterTooltip = {
      target: 'full-header'
    },
    virtual
  } = props;
  const warning = (0, _warning.devUseWarning)('Table');
  const rawColumns = React.useMemo(() => columns || (0, _table.convertChildrenToColumns)(children), [columns, children]);
  const baseColumns = (0, _useFilledColumns.default)(rawColumns, column);
  const needResponsive = React.useMemo(() => baseColumns.some(col => col.responsive), [baseColumns]);
  const screens = (0, _useBreakpoint.default)(needResponsive);
  const mergedColumns = React.useMemo(() => {
    const matched = new Set(Object.keys(screens).filter(m => screens[m]));
    return baseColumns.filter(c => !c.responsive || c.responsive.some(r => matched.has(r)));
  }, [baseColumns, screens]);
  const tableProps = (0, _util.omit)(props, ['className', 'style', 'column', 'columns']);
  const components = tableProps.components;
  const ariaProps = (0, _util.pickAttrs)(tableProps, {
    aria: true
  });
  const hasAriaProps = Object.keys(ariaProps).length > 0;
  const headerTableContext = React.useMemo(() => ({
    ariaProps,
    component: components?.header?.table
  }), [ariaProps, components?.header?.table]);
  const mergedComponents = React.useMemo(() => {
    if (!hasAriaProps) {
      return components;
    }
    return {
      ...components,
      header: {
        ...components?.header,
        table: HeaderTable
      }
    };
  }, [components, hasAriaProps]);
  const {
    locale: contextLocale = _en_US.default,
    table
  } = React.useContext(_context.ConfigContext);
  const {
    getPrefixCls,
    direction,
    renderEmpty,
    getPopupContainer: getContextPopupContainer,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = (0, _context.useComponentConfig)('table');
  const mergedSize = (0, _useSize.default)(ctx => customizeSize === 'middle' ? 'medium' : customizeSize ?? ctx);
  // =========== Merged Props for Semantic ==========
  const mergedProps = {
    ...props,
    size: mergedSize,
    bordered
  };
  const contextStyleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(contextStyle);
  const styleRoot = (0, _useMergeSemantic.useSemanticRootStyle)(style);
  const [mergedClassNames, mergedStyles] = (0, _useMergeSemantic.useMergeSemantic)([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  }, {
    pagination: {
      _default: 'root'
    },
    header: {
      _default: 'wrapper'
    },
    body: {
      _default: 'wrapper'
    }
  });
  const tableLocale = {
    ...contextLocale.Table,
    ...locale
  };
  const [globalLocale] = (0, _locale.useLocale)('global', _en_US.default.global);
  const rawData = dataSource || EMPTY_LIST;
  const prefixCls = getPrefixCls('table', customizePrefixCls);
  const dropdownPrefixCls = getPrefixCls('dropdown', customizeDropdownPrefixCls);
  const [, token] = (0, _internal.useToken)();
  const mergedRowSelection = React.useMemo(() => {
    return (0, _is.isPlainObject)(customizeRowSelection) ? {
      columnWidth: token.Table?.selectionColumnWidth,
      ...customizeRowSelection
    } : customizeRowSelection;
  }, [customizeRowSelection, token.Table?.selectionColumnWidth]);
  const rootCls = (0, _useCSSVarCls.default)(prefixCls);
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls, rootCls);
  const mergedExpandable = {
    childrenColumnName: legacyChildrenColumnName,
    expandIconColumnIndex,
    ...expandable,
    expandIcon: expandable?.expandIcon ?? table?.expandable?.expandIcon
  };
  const {
    childrenColumnName = 'children'
  } = mergedExpandable;
  const expandType = React.useMemo(() => {
    if (rawData.some(item => item?.[childrenColumnName])) {
      return 'nest';
    }
    if (expandedRowRender || expandable?.expandedRowRender) {
      return 'row';
    }
    return null;
  }, [childrenColumnName, rawData]);
  const internalRef = {
    body: React.useRef(null)
  };
  // ============================ Width =============================
  const getContainerWidth = (0, _useContainerWidth.default)(prefixCls);
  // ============================= Refs =============================
  const rootRef = React.useRef(null);
  const tblRef = React.useRef(null);
  (0, _hooks.useProxyImperativeHandle)(ref, () => ({
    ...tblRef.current,
    nativeElement: rootRef.current
  }));
  // ============================ RowKey ============================
  const rowKey = customizeRowKey || table?.rowKey || 'key';
  // ============================ Scroll ============================
  const mergedScroll = scroll ?? table?.scroll;
  if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_ENV !== "production" ? warning(!((0, _is.isFunction)(rowKey) && rowKey.length > 1), 'usage', '`index` parameter of `rowKey` function is deprecated. There is no guarantee that it will work as expected.') : void 0;
  }
  const getRowKey = React.useMemo(() => {
    if ((0, _is.isFunction)(rowKey)) {
      return rowKey;
    }
    return record => record?.[rowKey];
  }, [rowKey]);
  const [getRecordByKey] = (0, _useLazyKVMap.default)(rawData, childrenColumnName, getRowKey);
  // ============================ Events =============================
  const changeEventInfo = {};
  const triggerOnChange = (info, action, reset = false) => {
    const changeInfo = {
      ...changeEventInfo,
      ...info
    };
    if (reset) {
      changeEventInfo.resetPagination?.();
      // Reset event param
      if (changeInfo.pagination?.current) {
        changeInfo.pagination.current = 1;
      }
      // Trigger pagination events
      if (pagination) {
        pagination.onChange?.(1, changeInfo.pagination?.pageSize);
      }
    }
    if (scroll && scroll.scrollToFirstRowOnChange !== false && internalRef.body.current) {
      (0, _scrollTo.default)(0, {
        getContainer: () => internalRef.body.current
      });
    }
    onChange?.(changeInfo.pagination, changeInfo.filters, changeInfo.sorter, {
      currentDataSource: (0, _useFilter.getFilterData)((0, _useSorter.getSortData)(rawData, changeInfo.sorterStates, childrenColumnName), changeInfo.filterStates, childrenColumnName),
      action
    });
  };
  /**
   * Controlled state in `columns` is not a good idea that makes too many code (1000+ line?) to read
   * state out and then put it back to title render. Move these code into `hooks` but still too
   * complex. We should provides Table props like `sorter` & `filter` to handle control in next big
   * version.
   */
  // ============================ Sorter =============================
  const onSorterChange = (sorter, sorterStates) => {
    triggerOnChange({
      sorter,
      sorterStates
    }, 'sort', false);
  };
  const [transformSorterColumns, sortStates, sorterTitleProps, getSorters] = (0, _useSorter.default)({
    prefixCls,
    mergedColumns,
    // Pass `baseColumns` (pre-responsive) so `defaultSortOrder` and controlled
    // `sortOrder` on a `responsive` column are still honored when the column
    // is hidden at the current breakpoint.
    // See: https://github.com/ant-design/ant-design/issues/32847
    baseColumns,
    onSorterChange,
    sortDirections: sortDirections || ['ascend', 'descend'],
    tableLocale,
    showSorterTooltip,
    globalLocale
  });
  const sortedData = React.useMemo(() => (0, _useSorter.getSortData)(rawData, sortStates, childrenColumnName), [childrenColumnName, rawData, sortStates]);
  changeEventInfo.sorter = getSorters();
  changeEventInfo.sorterStates = sortStates;
  // ============================ Filter ============================
  const onFilterChange = (filters, filterStates) => {
    triggerOnChange({
      filters,
      filterStates
    }, 'filter', true);
  };
  const [transformFilterColumns, filterStates, filters] = (0, _useFilter.default)({
    prefixCls,
    locale: tableLocale,
    dropdownPrefixCls,
    mergedColumns,
    onFilterChange,
    getPopupContainer: getPopupContainer || getContextPopupContainer,
    rootClassName: (0, _clsx.clsx)(rootClassName, rootCls)
  });
  const mergedData = (0, _useFilter.getFilterData)(sortedData, filterStates, childrenColumnName);
  changeEventInfo.filters = filters;
  changeEventInfo.filterStates = filterStates;
  // ============================ Column ============================
  const columnTitleProps = (0, _useColumnTitleProps.default)(sorterTitleProps, filters);
  const [transformTitleColumns] = (0, _useTitleColumns.default)(columnTitleProps);
  // ========================== Pagination ==========================
  const onPaginationChange = (current, pageSize) => {
    triggerOnChange({
      pagination: {
        ...changeEventInfo.pagination,
        current,
        pageSize
      }
    }, 'paginate');
  };
  const [mergedPagination, resetPagination] = (0, _usePagination.default)(mergedData.length, onPaginationChange, pagination);
  changeEventInfo.pagination = pagination === false ? {} : (0, _usePagination.getPaginationParam)(mergedPagination, pagination);
  changeEventInfo.resetPagination = resetPagination;
  // ============================= Data =============================
  const pageData = React.useMemo(() => {
    if (pagination === false || !mergedPagination.pageSize) {
      return mergedData;
    }
    const {
      current = 1,
      total,
      pageSize = _usePagination.DEFAULT_PAGE_SIZE
    } = mergedPagination;
    process.env.NODE_ENV !== "production" ? warning(current > 0, 'usage', '`current` should be positive number.') : void 0;
    // Dynamic table data
    if (mergedData.length < total) {
      if (mergedData.length > pageSize) {
        process.env.NODE_ENV !== "production" ? warning(false, 'usage', '`dataSource` length is less than `pagination.total` but large than `pagination.pageSize`. Please make sure your config correct data with async mode.') : void 0;
        return mergedData.slice((current - 1) * pageSize, current * pageSize);
      }
      return mergedData;
    }
    return mergedData.slice((current - 1) * pageSize, current * pageSize);
  }, [!!pagination, mergedData, mergedPagination?.current, mergedPagination?.pageSize, mergedPagination?.total]);
  // ========================== Selections ==========================
  const [transformSelectionColumns, selectedKeySet] = (0, _useSelection.default)({
    prefixCls,
    data: mergedData,
    pageData,
    getRowKey,
    getRecordByKey,
    expandType,
    childrenColumnName,
    locale: tableLocale,
    getPopupContainer: getPopupContainer || getContextPopupContainer
  }, mergedRowSelection);
  const internalRowClassName = (record, index, indent) => {
    return (0, _clsx.clsx)({
      [`${prefixCls}-row-selected`]: selectedKeySet.has(getRowKey(record, index))
    }, (0, _is.isFunction)(rowClassName) ? rowClassName(record, index, indent) : rowClassName);
  };
  // ========================== Expandable ==========================
  // Pass origin render status into `@rc-component/table`, this can be removed when refactor with `@rc-component/table`
  mergedExpandable.__PARENT_RENDER_ICON__ = mergedExpandable.expandIcon;
  // Customize expandable icon
  mergedExpandable.expandIcon = mergedExpandable.expandIcon || expandIcon || (0, _ExpandIcon.default)(tableLocale);
  // Adjust expand icon index, no overwrite expandIconColumnIndex if set.
  if (expandType === 'nest' && mergedExpandable.expandIconColumnIndex === undefined) {
    mergedExpandable.expandIconColumnIndex = mergedRowSelection ? 1 : 0;
  } else if (mergedExpandable.expandIconColumnIndex > 0 && mergedRowSelection) {
    mergedExpandable.expandIconColumnIndex -= 1;
  }
  // Indent size
  if (!(0, _is.isNumber)(mergedExpandable.indentSize)) {
    mergedExpandable.indentSize = (0, _is.isNumber)(indentSize) ? indentSize : 15;
  }
  // ============================ Render ============================
  const transformColumns = React.useCallback(innerColumns => transformTitleColumns(transformSelectionColumns(transformFilterColumns(transformSorterColumns(innerColumns)))), [transformSorterColumns, transformFilterColumns, transformSelectionColumns]);
  let topPaginationNode;
  let bottomPaginationNode;
  if (pagination !== false && mergedPagination?.total) {
    const paginationSize = (0, _util2.getPaginationSize)(mergedPagination.size, mergedSize);
    const renderPagination = (placement = 'end') => (/*#__PURE__*/React.createElement(_pagination.default, {
      ...mergedPagination,
      classNames: mergedClassNames.pagination,
      styles: mergedStyles.pagination,
      className: (0, _clsx.clsx)(`${prefixCls}-pagination`, `${prefixCls}-pagination-${placement}`, mergedPagination.className),
      size: paginationSize
    }));
    const {
      placement,
      position
    } = mergedPagination;
    const mergedPlacement = placement ?? position;
    if (Array.isArray(mergedPlacement)) {
      const [topPos, bottomPos] = ['top', 'bottom'].map(dir => mergedPlacement.find(p => p.includes(dir)));
      const isDisable = mergedPlacement.every(p => `${p}` === 'none');
      if (!topPos && !bottomPos && !isDisable) {
        bottomPaginationNode = renderPagination();
      }
      if (topPos) {
        topPaginationNode = renderPagination((0, _util2.normalizePlacement)(topPos));
      }
      if (bottomPos) {
        bottomPaginationNode = renderPagination((0, _util2.normalizePlacement)(bottomPos));
      }
    } else {
      bottomPaginationNode = renderPagination();
    }
    if (process.env.NODE_ENV !== 'production') {
      warning.deprecated(!position, 'pagination.position', 'pagination.placement');
    }
  }
  // >>>>>>>>> Spinning
  const spinProps = (0, _useSpinProps.default)(loading);
  const wrappercls = (0, _clsx.clsx)(cssVarCls, rootCls, `${prefixCls}-wrapper`, contextClassName, {
    [`${prefixCls}-wrapper-rtl`]: direction === 'rtl'
  }, className, rootClassName, mergedClassNames.root, hashId);
  // ========== empty ==========
  const mergedEmptyNode = React.useMemo(() => {
    // When dataSource is null/undefined (detected by reference equality with EMPTY_LIST),
    // and the table is in a loading state, we only show the loading spinner without the empty placeholder.
    // For empty arrays (datasource={[]}), both loading and empty states would normally be shown.
    // discussion https://github.com/ant-design/ant-design/issues/54601#issuecomment-3158091383
    if (spinProps?.spinning && rawData === EMPTY_LIST) {
      return null;
    }
    if (typeof locale?.emptyText !== 'undefined') {
      return locale.emptyText;
    }
    return renderEmpty?.('Table') || /*#__PURE__*/React.createElement(_defaultRenderEmpty.default, {
      componentName: "Table"
    });
  }, [spinProps?.spinning, rawData, locale?.emptyText, renderEmpty]);
  // ========================== Render ==========================
  const TableComponent = virtual ? _VirtualTable.default : _RcTable.default;
  // >>> Virtual Table props. We set height here since it will affect height collection
  const virtualProps = {};
  const listItemHeight = React.useMemo(() => {
    const {
      fontSize,
      lineHeight,
      lineWidth,
      padding,
      paddingXS,
      paddingSM
    } = token;
    const fontHeight = Math.floor(fontSize * lineHeight);
    switch (mergedSize) {
      case 'medium':
        return paddingSM * 2 + fontHeight + lineWidth;
      case 'small':
        return paddingXS * 2 + fontHeight + lineWidth;
      default:
        return padding * 2 + fontHeight + lineWidth;
    }
  }, [token, mergedSize]);
  if (virtual) {
    virtualProps.listItemHeight = listItemHeight;
  }
  return /*#__PURE__*/React.createElement("div", {
    ref: rootRef,
    className: wrappercls,
    style: mergedStyles.root
  }, /*#__PURE__*/React.createElement(_spin.default, {
    spinning: false,
    ...spinProps
  }, topPaginationNode, /*#__PURE__*/React.createElement(HeaderTableContext.Provider, {
    value: headerTableContext
  }, /*#__PURE__*/React.createElement(TableComponent, {
    ...virtualProps,
    ...tableProps,
    components: mergedComponents,
    scroll: mergedScroll,
    classNames: mergedClassNames,
    styles: mergedStyles,
    ref: tblRef,
    columns: mergedColumns,
    direction: direction,
    expandable: mergedExpandable,
    prefixCls: prefixCls,
    className: (0, _clsx.clsx)({
      [`${prefixCls}-medium`]: mergedSize === 'medium',
      [`${prefixCls}-small`]: mergedSize === 'small',
      [`${prefixCls}-bordered`]: bordered,
      [`${prefixCls}-empty`]: rawData.length === 0
    }, cssVarCls, rootCls, hashId),
    data: pageData,
    rowKey: getRowKey,
    rowClassName: internalRowClassName,
    emptyText: mergedEmptyNode,
    // Internal
    internalHooks: _table.INTERNAL_HOOKS,
    internalRefs: internalRef,
    transformColumns: transformColumns,
    getContainerWidth: getContainerWidth,
    measureRowRender: measureRow => (/*#__PURE__*/React.createElement(_TableMeasureRowContext.default.Provider, {
      value: true
    }, /*#__PURE__*/React.createElement(_configProvider.default, {
      getPopupContainer: node => node
    }, measureRow)))
  })), bottomPaginationNode));
};
var _default = exports.default = /*#__PURE__*/React.forwardRef(InternalTable);
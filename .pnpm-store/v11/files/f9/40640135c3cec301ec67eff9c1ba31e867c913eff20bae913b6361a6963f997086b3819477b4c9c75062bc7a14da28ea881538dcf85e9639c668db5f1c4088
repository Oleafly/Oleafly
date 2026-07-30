"use client";

import _toConsumableArray from "@babel/runtime/helpers/esm/toConsumableArray";
import React, { useCallback, useContext } from 'react';
import { pickAttrs } from '@rc-component/util';
import { clsx } from 'clsx';
import { useMultipleSelect } from '../_util/hooks';
import { useMergeSemantic, useSemanticRootStyle } from '../_util/hooks/useMergeSemantic';
import { isFunction, isNonNullable } from '../_util/is';
import { getMergedStatus, getStatusClassNames } from '../_util/statusUtils';
import { groupDisabledKeysMap, groupKeysMap } from '../_util/transKeys';
import { devUseWarning } from '../_util/warning';
import { useComponentConfig } from '../config-provider/context';
import DefaultRenderEmpty from '../config-provider/defaultRenderEmpty';
import DisabledContext from '../config-provider/DisabledContext';
import { FormItemInputContext } from '../form/context';
import { useLocale } from '../locale';
import defaultLocale from '../locale/en_US';
import Actions from './Actions';
import useData from './hooks/useData';
import useSelection from './hooks/useSelection';
import Search from './search';
import Section from './Section';
import useStyle from './style';
const Transfer = props => {
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    classNames,
    styles,
    style,
    listStyle,
    operationStyle,
    operations,
    actions,
    dataSource,
    targetKeys = [],
    selectedKeys,
    selectAllLabels = [],
    locale = {},
    titles,
    disabled,
    showSearch = false,
    showSelectAll,
    oneWay,
    pagination,
    status: customStatus,
    selectionsIcon,
    filterOption,
    render,
    footer,
    children,
    rowKey,
    onScroll,
    onChange,
    onSearch,
    onSelectChange,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    renderEmpty,
    direction: dir,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles,
    selectionsIcon: contextSelectionsIcon
  } = useComponentConfig('transfer');
  const contextDisabled = useContext(DisabledContext);
  const mergedDisabled = disabled ?? contextDisabled;
  // =========== Merged Props for Semantic ==========
  const mergedProps = {
    ...props,
    disabled: mergedDisabled
  };
  const prefixCls = getPrefixCls('transfer', customizePrefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls);
  const mergedActions = actions || operations || [];
  const isRtl = dir === 'rtl';
  // Fill record with `key`
  const [mergedDataSource, leftDataSource, rightDataSource] = useData(dataSource, rowKey, targetKeys);
  // Get direction selected keys
  const [
  // Keys
  sourceSelectedKeys, targetSelectedKeys,
  // Setters
  setSourceSelectedKeys, setTargetSelectedKeys] = useSelection(leftDataSource, rightDataSource, selectedKeys);
  const [leftMultipleSelect, updateLeftPrevSelectedIndex] = useMultipleSelect(item => item.key);
  const [rightMultipleSelect, updateRightPrevSelectedIndex] = useMultipleSelect(item => item.key);
  const setStateKeys = useCallback((direction, keys) => {
    if (direction === 'left') {
      setSourceSelectedKeys(isFunction(keys) ? keys(sourceSelectedKeys || []) : keys);
    } else {
      setTargetSelectedKeys(isFunction(keys) ? keys(targetSelectedKeys || []) : keys);
    }
  }, [sourceSelectedKeys, targetSelectedKeys]);
  const setPrevSelectedIndex = (direction, value) => {
    const isLeftDirection = direction === 'left';
    const updatePrevSelectedIndex = isLeftDirection ? updateLeftPrevSelectedIndex : updateRightPrevSelectedIndex;
    updatePrevSelectedIndex(value);
  };
  const handleSelectChange = useCallback((direction, holder) => {
    if (direction === 'left') {
      onSelectChange?.(holder, targetSelectedKeys);
    } else {
      onSelectChange?.(sourceSelectedKeys, holder);
    }
  }, [sourceSelectedKeys, targetSelectedKeys]);
  const getTitles = transferLocale => titles ?? transferLocale.titles ?? [];
  const handleLeftScroll = e => {
    onScroll?.('left', e);
  };
  const handleRightScroll = e => {
    onScroll?.('right', e);
  };
  const moveTo = direction => {
    const moveKeys = direction === 'right' ? sourceSelectedKeys : targetSelectedKeys;
    const dataSourceDisabledKeysMap = groupDisabledKeysMap(mergedDataSource);
    // filter the disabled options
    const newMoveKeys = moveKeys.filter(key => !dataSourceDisabledKeysMap.has(key));
    const newMoveKeysMap = groupKeysMap(newMoveKeys);
    // move items to target box
    const newTargetKeys = direction === 'right' ? newMoveKeys.concat(targetKeys) : targetKeys.filter(targetKey => !newMoveKeysMap.has(targetKey));
    // empty checked keys
    const oppositeDirection = direction === 'right' ? 'left' : 'right';
    setStateKeys(oppositeDirection, []);
    handleSelectChange(oppositeDirection, []);
    onChange?.(newTargetKeys, direction, newMoveKeys);
  };
  const moveToLeft = () => {
    moveTo('left');
    setPrevSelectedIndex('left', null);
  };
  const moveToRight = () => {
    moveTo('right');
    setPrevSelectedIndex('right', null);
  };
  const onItemSelectAll = (direction, keys, checkAll) => {
    setStateKeys(direction, prevKeys => {
      let mergedCheckedKeys = [];
      if (checkAll === 'replace') {
        mergedCheckedKeys = keys;
      } else if (checkAll) {
        // Merge current keys with origin key
        mergedCheckedKeys = Array.from(new Set([].concat(_toConsumableArray(prevKeys), _toConsumableArray(keys))));
      } else {
        const selectedKeysMap = groupKeysMap(keys);
        // Remove current keys from origin keys
        mergedCheckedKeys = prevKeys.filter(key => !selectedKeysMap.has(key));
      }
      handleSelectChange(direction, mergedCheckedKeys);
      return mergedCheckedKeys;
    });
    setPrevSelectedIndex(direction, null);
  };
  const onLeftItemSelectAll = (keys, checkAll) => onItemSelectAll('left', keys, checkAll);
  const onRightItemSelectAll = (keys, checkAll) => onItemSelectAll('right', keys, checkAll);
  const leftFilter = e => onSearch?.('left', e.target.value);
  const rightFilter = e => onSearch?.('right', e.target.value);
  const handleLeftClear = () => onSearch?.('left', '');
  const handleRightClear = () => onSearch?.('right', '');
  const handleSingleSelect = (direction, holder, selectedKey, checked, currentSelectedIndex) => {
    const isSelected = holder.has(selectedKey);
    if (isSelected) {
      holder.delete(selectedKey);
      setPrevSelectedIndex(direction, null);
    }
    if (checked) {
      holder.add(selectedKey);
      setPrevSelectedIndex(direction, currentSelectedIndex);
    }
  };
  const handleMultipleSelect = (direction, data, holder, currentSelectedIndex) => {
    const isLeftDirection = direction === 'left';
    const multipleSelect = isLeftDirection ? leftMultipleSelect : rightMultipleSelect;
    multipleSelect(currentSelectedIndex, data, holder);
  };
  const onItemSelect = (direction, selectedKey, checked, multiple) => {
    const isLeftDirection = direction === 'left';
    const holder = isLeftDirection ? sourceSelectedKeys : targetSelectedKeys;
    const holderSet = new Set(holder);
    const data = (isLeftDirection ? leftDataSource : rightDataSource).filter(item => !item.disabled);
    const currentSelectedIndex = data.findIndex(item => item.key === selectedKey);
    // multiple select by hold down the shift key
    if (multiple && holder.length > 0) {
      handleMultipleSelect(direction, data, holderSet, currentSelectedIndex);
    } else {
      handleSingleSelect(direction, holderSet, selectedKey, checked, currentSelectedIndex);
    }
    const holderArr = Array.from(holderSet);
    handleSelectChange(direction, holderArr);
    if (!props.selectedKeys) {
      setStateKeys(direction, holderArr);
    }
  };
  const onLeftItemSelect = (selectedKey, checked, e) => {
    onItemSelect('left', selectedKey, checked, e?.shiftKey);
  };
  const onRightItemSelect = (selectedKey, checked, e) => {
    onItemSelect('right', selectedKey, checked, e?.shiftKey);
  };
  const onRightItemRemove = keys => {
    setStateKeys('right', []);
    onChange?.(targetKeys.filter(key => !keys.includes(key)), 'left', _toConsumableArray(keys));
  };
  const handleListStyle = direction => {
    if (isFunction(listStyle)) {
      return listStyle({
        direction
      });
    }
    return listStyle || {};
  };
  const {
    hasFeedback,
    status
  } = useContext(FormItemInputContext);
  const getLocale = transferLocale => ({
    ...transferLocale,
    notFoundContent: renderEmpty?.('Transfer') || /*#__PURE__*/React.createElement(DefaultRenderEmpty, {
      componentName: "Transfer"
    }),
    ...locale
  });
  const mergedStatus = getMergedStatus(status, customStatus);
  const mergedPagination = !children && pagination;
  const leftActive = rightDataSource.some(data => isNonNullable(data.key) && targetSelectedKeys.includes(data.key) && !data.disabled);
  const rightActive = leftDataSource.some(data => isNonNullable(data.key) && sourceSelectedKeys.includes(data.key) && !data.disabled);
  // ====================== Styles ======================
  const contextStyleRoot = useSemanticRootStyle(contextStyle);
  const styleRoot = useSemanticRootStyle(style);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, classNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props: mergedProps
  }, {
    source: {},
    target: {}
  });
  const cls = clsx(prefixCls, {
    [`${prefixCls}-disabled`]: mergedDisabled,
    [`${prefixCls}-customize-list`]: !!children,
    [`${prefixCls}-rtl`]: isRtl
  }, getStatusClassNames(prefixCls, mergedStatus, hasFeedback), contextClassName, className, rootClassName, hashId, cssVarCls, mergedClassNames.root);
  // ====================== Locale ======================
  const [contextLocale] = useLocale('Transfer', defaultLocale.Transfer);
  const listLocale = getLocale(contextLocale);
  const [leftTitle, rightTitle] = getTitles(listLocale);
  const mergedSelectionsIcon = selectionsIcon ?? contextSelectionsIcon;
  const sectionSemanticKeys = ['section', 'header', 'title', 'body', 'list', 'item', 'itemIcon', 'itemContent', 'footer'];
  const getMergedSectionClassNames = direction => {
    const mergedSectionClassNames = {
      ...mergedClassNames
    };
    const directionClassNames = mergedClassNames[direction];
    sectionSemanticKeys.forEach(key => {
      mergedSectionClassNames[key] = clsx(mergedClassNames[key], directionClassNames?.[key]);
    });
    return mergedSectionClassNames;
  };
  const getMergedSectionStyles = direction => {
    const mergedSectionStyles = {
      ...mergedStyles
    };
    const directionStyles = mergedStyles[direction];
    sectionSemanticKeys.forEach(key => {
      mergedSectionStyles[key] = {
        ...mergedStyles[key],
        ...directionStyles?.[key]
      };
    });
    return mergedSectionStyles;
  };
  const sourceSectionClassNames = getMergedSectionClassNames('source');
  const targetSectionClassNames = getMergedSectionClassNames('target');
  const sourceSectionStyles = getMergedSectionStyles('source');
  const targetSectionStyles = getMergedSectionStyles('target');
  const rootProps = pickAttrs(restProps, {
    aria: true,
    data: true
  });
  // ===================== Warning ======================
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Transfer');
    process.env.NODE_ENV !== "production" ? warning(!pagination || !children, 'usage', '`pagination` not support customize render list.') : void 0;
    [['listStyle', 'styles.section'], ['operationStyle', 'styles.actions'], ['operations', 'actions']].forEach(([deprecatedName, newName]) => {
      warning.deprecated(!(deprecatedName in props), deprecatedName, newName);
    });
  }
  // ====================== Render ======================
  return /*#__PURE__*/React.createElement("div", {
    ...rootProps,
    className: cls,
    style: mergedStyles.root
  }, /*#__PURE__*/React.createElement(Section, {
    prefixCls: prefixCls,
    style: handleListStyle('left'),
    classNames: sourceSectionClassNames,
    styles: sourceSectionStyles,
    titleText: leftTitle,
    dataSource: leftDataSource,
    filterOption: filterOption,
    checkedKeys: sourceSelectedKeys,
    handleFilter: leftFilter,
    handleClear: handleLeftClear,
    onItemSelect: onLeftItemSelect,
    onItemSelectAll: onLeftItemSelectAll,
    render: render,
    showSearch: showSearch,
    renderList: children,
    footer: footer,
    onScroll: handleLeftScroll,
    disabled: mergedDisabled,
    direction: isRtl ? 'right' : 'left',
    showSelectAll: showSelectAll,
    selectAllLabel: selectAllLabels[0],
    pagination: mergedPagination,
    selectionsIcon: mergedSelectionsIcon,
    ...listLocale
  }), /*#__PURE__*/React.createElement(Actions, {
    className: clsx(`${prefixCls}-actions`, mergedClassNames.actions),
    rightActive: rightActive,
    moveToRight: moveToRight,
    leftActive: leftActive,
    actions: mergedActions,
    moveToLeft: moveToLeft,
    style: {
      ...operationStyle,
      ...mergedStyles.actions
    },
    disabled: mergedDisabled,
    direction: dir,
    oneWay: oneWay
  }), /*#__PURE__*/React.createElement(Section, {
    prefixCls: prefixCls,
    style: handleListStyle('right'),
    classNames: targetSectionClassNames,
    styles: targetSectionStyles,
    titleText: rightTitle,
    dataSource: rightDataSource,
    filterOption: filterOption,
    checkedKeys: targetSelectedKeys,
    handleFilter: rightFilter,
    handleClear: handleRightClear,
    onItemSelect: onRightItemSelect,
    onItemSelectAll: onRightItemSelectAll,
    onItemRemove: onRightItemRemove,
    render: render,
    showSearch: showSearch,
    renderList: children,
    footer: footer,
    onScroll: handleRightScroll,
    disabled: mergedDisabled,
    direction: isRtl ? 'left' : 'right',
    showSelectAll: showSelectAll,
    selectAllLabel: selectAllLabels[1],
    showRemove: oneWay,
    pagination: mergedPagination,
    selectionsIcon: mergedSelectionsIcon,
    ...listLocale
  }));
};
if (process.env.NODE_ENV !== 'production') {
  Transfer.displayName = 'Transfer';
}
Transfer.List = Section;
Transfer.Search = Search;
Transfer.Operation = Actions;
export default Transfer;
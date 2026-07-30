"use client";

import _toConsumableArray from "@babel/runtime/helpers/esm/toConsumableArray";
import * as React from 'react';
import FileOutlined from "@ant-design/icons/es/icons/FileOutlined";
import FolderOpenOutlined from "@ant-design/icons/es/icons/FolderOpenOutlined";
import FolderOutlined from "@ant-design/icons/es/icons/FolderOutlined";
import { conductExpandParent, convertDataToEntities, convertTreeToData } from '@rc-component/tree';
import { clsx } from 'clsx';
import { ConfigContext } from '../config-provider';
import Tree from './Tree';
import { calcRangeKeys, convertDirectoryKeysToNodes } from './utils/dictUtil';
function getIcon(props) {
  const {
    isLeaf,
    expanded
  } = props;
  if (isLeaf) {
    return /*#__PURE__*/React.createElement(FileOutlined, null);
  }
  return expanded ? /*#__PURE__*/React.createElement(FolderOpenOutlined, null) : /*#__PURE__*/React.createElement(FolderOutlined, null);
}
function getTreeData({
  treeData,
  children
}) {
  return treeData || convertTreeToData(children);
}
const DirectoryTree = /*#__PURE__*/React.forwardRef((oriProps, ref) => {
  const {
    defaultExpandAll,
    defaultExpandParent = true,
    defaultExpandedKeys,
    ...props
  } = oriProps;
  // Shift click usage
  const lastSelectedKeyRef = React.useRef(null);
  const cachedSelectedKeysRef = React.useRef(null);
  const getInitExpandedKeys = () => {
    const {
      keyEntities
    } = convertDataToEntities(getTreeData(props), {
      fieldNames: props.fieldNames
    });
    let initExpandedKeys;
    const mergedExpandedKeys = props.expandedKeys || defaultExpandedKeys || [];
    // Expanded keys
    if (defaultExpandAll) {
      initExpandedKeys = Object.keys(keyEntities);
    } else if (defaultExpandParent) {
      initExpandedKeys = conductExpandParent(mergedExpandedKeys, keyEntities);
    } else {
      initExpandedKeys = mergedExpandedKeys;
    }
    return initExpandedKeys;
  };
  const [selectedKeys, setSelectedKeys] = React.useState(props.selectedKeys || props.defaultSelectedKeys || []);
  const [expandedKeys, setExpandedKeys] = React.useState(() => getInitExpandedKeys());
  React.useEffect(() => {
    if ('selectedKeys' in props) {
      setSelectedKeys(props.selectedKeys);
    }
  }, [props.selectedKeys]);
  React.useEffect(() => {
    if ('expandedKeys' in props) {
      setExpandedKeys(props.expandedKeys);
    }
  }, [props.expandedKeys]);
  const onExpand = (keys, info) => {
    if (!('expandedKeys' in props)) {
      setExpandedKeys(keys);
    }
    // Call origin function
    return props.onExpand?.(keys, info);
  };
  const onSelect = (keys, event) => {
    const {
      multiple,
      fieldNames
    } = props;
    const {
      node,
      nativeEvent
    } = event;
    const {
      key = ''
    } = node;
    const treeData = getTreeData(props);
    // We need wrap this event since some value is not same
    const newEvent = {
      ...event,
      selected: true // Directory selected always true
    };
    // Windows / Mac single pick
    const ctrlPick = nativeEvent?.ctrlKey || nativeEvent?.metaKey;
    const shiftPick = nativeEvent?.shiftKey;
    // Generate new selected keys
    let newSelectedKeys;
    if (multiple && ctrlPick) {
      // Control click
      newSelectedKeys = keys;
      lastSelectedKeyRef.current = key;
      cachedSelectedKeysRef.current = newSelectedKeys;
      newEvent.selectedNodes = convertDirectoryKeysToNodes(treeData, newSelectedKeys, fieldNames);
    } else if (multiple && shiftPick) {
      // Shift click
      newSelectedKeys = Array.from(new Set([].concat(_toConsumableArray(cachedSelectedKeysRef.current || []), _toConsumableArray(calcRangeKeys({
        treeData,
        expandedKeys,
        startKey: key,
        endKey: lastSelectedKeyRef.current,
        fieldNames
      })))));
      newEvent.selectedNodes = convertDirectoryKeysToNodes(treeData, newSelectedKeys, fieldNames);
    } else {
      // Single click
      newSelectedKeys = [key];
      lastSelectedKeyRef.current = key;
      cachedSelectedKeysRef.current = newSelectedKeys;
      newEvent.selectedNodes = convertDirectoryKeysToNodes(treeData, newSelectedKeys, fieldNames);
    }
    props.onSelect?.(newSelectedKeys, newEvent);
    if (!('selectedKeys' in props)) {
      setSelectedKeys(newSelectedKeys);
    }
  };
  const {
    getPrefixCls,
    direction
  } = React.useContext(ConfigContext);
  const {
    prefixCls: customizePrefixCls,
    className,
    showIcon = true,
    expandAction = 'click',
    ...restProps
  } = props;
  const prefixCls = getPrefixCls('tree', customizePrefixCls);
  const connectClassName = clsx(`${prefixCls}-directory`, {
    [`${prefixCls}-directory-rtl`]: direction === 'rtl'
  }, className);
  return /*#__PURE__*/React.createElement(Tree, {
    icon: getIcon,
    ref: ref,
    blockNode: true,
    ...restProps,
    showIcon: showIcon,
    expandAction: expandAction,
    prefixCls: prefixCls,
    className: connectClassName,
    defaultExpandParent: defaultExpandParent,
    expandedKeys: expandedKeys,
    selectedKeys: selectedKeys,
    onSelect: onSelect,
    onExpand: onExpand
  });
});
if (process.env.NODE_ENV !== 'production') {
  DirectoryTree.displayName = 'DirectoryTree';
}
export default DirectoryTree;
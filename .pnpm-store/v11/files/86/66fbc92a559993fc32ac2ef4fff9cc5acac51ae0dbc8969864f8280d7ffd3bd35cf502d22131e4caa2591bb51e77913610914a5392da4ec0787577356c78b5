import type { DataNode } from '@rc-component/tree';
import type React from 'react';
import type { TreeProps } from '../Tree';
type FieldNames = TreeProps['fieldNames'];
/** 计算选中范围，只考虑expanded情况以优化性能 */
export declare function calcRangeKeys({ treeData, expandedKeys, startKey, endKey, fieldNames, }: {
    treeData: DataNode[];
    expandedKeys: React.Key[];
    startKey?: React.Key;
    endKey?: React.Key;
    fieldNames?: FieldNames;
}): React.Key[];
export declare function convertDirectoryKeysToNodes(treeData: DataNode[], keys: React.Key[], fieldNames?: FieldNames): DataNode[];
export {};

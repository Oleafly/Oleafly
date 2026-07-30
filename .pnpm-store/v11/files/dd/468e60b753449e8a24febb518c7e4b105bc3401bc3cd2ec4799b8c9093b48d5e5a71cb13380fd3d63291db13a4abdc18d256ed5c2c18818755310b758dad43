import * as React from 'react';
import type RcTree from '@rc-component/tree';
import type { BasicDataNode, DataNode } from '@rc-component/tree';
import type { TreeProps } from './Tree';
export type ExpandAction = false | 'click' | 'doubleClick';
export interface DirectoryTreeProps<T extends BasicDataNode = DataNode> extends TreeProps<T> {
    expandAction?: ExpandAction;
}
type DirectoryTreeCompoundedComponent = (<T extends BasicDataNode | DataNode = DataNode>(props: React.PropsWithChildren<DirectoryTreeProps<T>> & React.RefAttributes<RcTree>) => React.ReactElement) & Pick<React.FC, 'displayName'>;
export interface DirectoryTreeState {
    expandedKeys?: React.Key[];
    selectedKeys?: React.Key[];
}
declare const DirectoryTree: DirectoryTreeCompoundedComponent;
export default DirectoryTree;

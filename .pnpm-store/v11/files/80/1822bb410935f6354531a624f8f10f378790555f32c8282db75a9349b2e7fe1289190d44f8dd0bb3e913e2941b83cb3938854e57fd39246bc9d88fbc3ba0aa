import type { Component } from 'react';
import React from 'react';
import type { BasicDataNode, DataNode, TreeProps as RcTreeProps } from '@rc-component/tree';
import RcTree from '@rc-component/tree';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
export type SwitcherIcon = React.ReactNode | ((props: AntTreeNodeProps) => React.ReactNode);
export type TreeLeafIcon = React.ReactNode | ((props: AntTreeNodeProps) => React.ReactNode);
type TreeIcon = React.ReactNode | ((props: AntdTreeNodeAttribute) => React.ReactNode);
export interface AntdTreeNodeAttribute {
    eventKey: string;
    prefixCls: string;
    className: string;
    expanded: boolean;
    selected: boolean;
    checked: boolean;
    halfChecked: boolean;
    children: React.ReactNode;
    title: React.ReactNode;
    pos: string;
    dragOver: boolean;
    dragOverGapTop: boolean;
    dragOverGapBottom: boolean;
    isLeaf: boolean;
    selectable: boolean;
    disabled: boolean;
    disableCheckbox: boolean;
}
export interface AntTreeNodeProps {
    className?: string;
    checkable?: boolean;
    disabled?: boolean;
    disableCheckbox?: boolean;
    title?: React.ReactNode | ((data: DataNode) => React.ReactNode);
    key?: React.Key;
    eventKey?: React.Key;
    isLeaf?: boolean;
    checked?: boolean;
    expanded?: boolean;
    loading?: boolean;
    selected?: boolean;
    selectable?: boolean;
    icon?: TreeIcon;
    children?: React.ReactNode;
    [customProp: string]: any;
}
export interface AntTreeNode extends Component<AntTreeNodeProps> {
}
export interface AntTreeNodeBaseEvent {
    node: AntTreeNode;
    nativeEvent: MouseEvent;
}
export interface AntTreeNodeCheckedEvent extends AntTreeNodeBaseEvent {
    event: 'check';
    checked?: boolean;
    checkedNodes?: AntTreeNode[];
}
export interface AntTreeNodeSelectedEvent extends AntTreeNodeBaseEvent {
    event: 'select';
    selected?: boolean;
    selectedNodes?: DataNode[];
}
export interface AntTreeNodeExpandedEvent extends AntTreeNodeBaseEvent {
    expanded?: boolean;
}
export interface AntTreeNodeMouseEvent {
    node: AntTreeNode;
    event: React.DragEvent<HTMLElement>;
}
export interface AntTreeNodeDragEnterEvent extends AntTreeNodeMouseEvent {
    expandedKeys: React.Key[];
}
export interface AntTreeNodeDropEvent {
    node: AntTreeNode;
    dragNode: AntTreeNode;
    dragNodesKeys: React.Key[];
    dropPosition: number;
    dropToGap?: boolean;
    event: React.MouseEvent<HTMLElement>;
}
export type TreeNodeNormal = DataNode;
type DraggableFn = (node: DataNode) => boolean;
interface DraggableConfig {
    icon?: React.ReactNode;
    nodeDraggable?: DraggableFn;
}
export type TreeSemanticType = {
    classNames?: {
        root?: string;
        item?: string;
        itemIcon?: string;
        itemTitle?: string;
        itemSwitcher?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        item?: React.CSSProperties;
        itemIcon?: React.CSSProperties;
        itemTitle?: React.CSSProperties;
        itemSwitcher?: React.CSSProperties;
    };
};
export type TreeSemanticAllType = GenerateSemantic<TreeSemanticType, TreeProps>;
export interface TreeProps<T extends BasicDataNode = DataNode> extends Omit<RcTreeProps<T>, 'prefixCls' | 'showLine' | 'direction' | 'draggable' | 'icon' | 'switcherIcon' | 'classNames' | 'styles' | 'rootStyle'> {
    showLine?: boolean | {
        showLeafIcon: boolean | TreeLeafIcon;
    };
    className?: string;
    classNames?: TreeSemanticAllType['classNamesAndFn'];
    styles?: TreeSemanticAllType['stylesAndFn'];
    /** @deprecated Please use `styles.root` instead */
    rootStyle?: React.CSSProperties;
    /** Whether to support multiple selection */
    multiple?: boolean;
    /** Whether to automatically expand the parent node */
    autoExpandParent?: boolean;
    /** Node selection in Checkable state is fully controlled (the selected state of parent and child nodes is no longer associated) */
    checkStrictly?: boolean;
    /** Whether to support selection */
    checkable?: boolean;
    /** whether to disable the tree */
    disabled?: boolean;
    /** Expand all tree nodes by default */
    defaultExpandAll?: boolean;
    /** Expand the corresponding tree node by default */
    defaultExpandParent?: boolean;
    /** Expand the specified tree node by default */
    defaultExpandedKeys?: React.Key[];
    /** (Controlled) Expand the specified tree node */
    expandedKeys?: React.Key[];
    /** (Controlled) Tree node with checked checkbox */
    checkedKeys?: React.Key[] | {
        checked: React.Key[];
        halfChecked: React.Key[];
    };
    /** Tree node with checkbox checked by default */
    defaultCheckedKeys?: React.Key[];
    /** (Controlled) Set the selected tree node */
    selectedKeys?: React.Key[];
    /** Tree node selected by default */
    defaultSelectedKeys?: React.Key[];
    selectable?: boolean;
    /** Click on the tree node to trigger */
    filterAntTreeNode?: (node: AntTreeNode) => boolean;
    loadedKeys?: React.Key[];
    /** Set the node to be draggable (IE>8) */
    draggable?: DraggableFn | boolean | DraggableConfig;
    style?: React.CSSProperties;
    showIcon?: boolean;
    icon?: TreeIcon;
    switcherIcon?: SwitcherIcon;
    switcherLoadingIcon?: React.ReactNode;
    prefixCls?: string;
    children?: React.ReactNode;
    blockNode?: boolean;
}
declare const Tree: React.ForwardRefExoticComponent<TreeProps<DataNode> & React.RefAttributes<RcTree<DataNode>>>;
export default Tree;

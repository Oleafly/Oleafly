import type { NodeBase, NodeDragItem, EdgeBase, CoordinateExtent, NodeOrigin, OnError, SnapGrid, Transform, PanBy, OnSelectionDrag, UpdateNodePositions, InternalNodeBase } from '../types';
export type OnDrag<NodeType extends NodeBase = NodeBase> = (event: MouseEvent, dragItems: Map<string, NodeDragItem>, node: NodeType, nodes: NodeType[]) => void;
type OnNodeDrag<NodeType extends NodeBase = NodeBase> = (e: MouseEvent | TouchEvent, node: NodeType, nodes: NodeType[]) => void | undefined;
type FlowGraph<NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase> = {
    nodes: NodeType[];
    edges: EdgeType[];
};
type StoreItems<NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase> = {
    nodes: NodeType[];
    nodeLookup: Map<string, InternalNodeBase<NodeType>>;
    edges: EdgeType[];
    nodeExtent: CoordinateExtent;
    snapGrid: SnapGrid;
    snapToGrid: boolean;
    nodeOrigin: NodeOrigin;
    multiSelectionActive: boolean;
    domNode?: Element | null;
    transform: Transform;
    autoPanOnNodeDrag: boolean;
    nodesDraggable: boolean;
    selectNodesOnDrag: boolean;
    nodeDragThreshold: number;
    panBy: PanBy;
    unselectNodesAndEdges: (params?: Partial<FlowGraph<NodeType, EdgeType>>) => void;
    onError?: OnError;
    onNodeDragStart?: OnNodeDrag<NodeType>;
    onNodeDrag?: OnNodeDrag<NodeType>;
    onNodeDragStop?: OnNodeDrag<NodeType>;
    onSelectionDragStart?: OnSelectionDrag<NodeType>;
    onSelectionDrag?: OnSelectionDrag<NodeType>;
    onSelectionDragStop?: OnSelectionDrag<NodeType>;
    updateNodePositions: UpdateNodePositions<InternalNodeBase<NodeType>>;
    autoPanSpeed?: number;
};
export type XYDragParams<NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase> = {
    getStoreItems: () => StoreItems<NodeType, EdgeType>;
    onDragStart?: OnDrag<NodeType>;
    onDrag?: OnDrag<NodeType>;
    onDragStop?: OnDrag<NodeType>;
    onNodeMouseDown?: (id: string) => void;
    autoPanSpeed?: number;
};
export type XYDragInstance = {
    update: (params: DragUpdateParams) => void;
    destroy: () => void;
};
export type DragUpdateParams = {
    noDragClassName?: string;
    handleSelector?: string;
    isSelectable?: boolean;
    nodeId?: string;
    domNode: Element;
    nodeClickDistance?: number;
};
export declare function XYDrag<NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>({ onNodeMouseDown, getStoreItems, onDragStart, onDrag, onDragStop, }: XYDragParams<NodeType, EdgeType>): XYDragInstance;
export {};
//# sourceMappingURL=XYDrag.d.ts.map
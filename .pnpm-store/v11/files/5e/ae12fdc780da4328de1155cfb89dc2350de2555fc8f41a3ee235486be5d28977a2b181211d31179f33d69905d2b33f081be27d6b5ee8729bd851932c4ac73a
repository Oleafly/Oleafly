export type NodeSize = {
    width: number;
    height: number;
};
export type NodeSizeMap = Record<string, NodeSize>;
/**
 * Stores measured node sizes by key and exposes a ref callback to update them.
 */
export default function useSizes(): readonly [NodeSizeMap, (key: string, node: HTMLDivElement | null) => void];

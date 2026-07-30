import * as React from 'react';
import type { GetKey, GetSize } from '../interface';
import type CacheMap from '../utils/CacheMap';
export type ScrollAlign = 'top' | 'bottom' | 'auto';
export type ScrollPos = {
    left?: number;
    top?: number;
};
export interface ScrollOffsetInfo {
    /**
     * Get item size range by key.
     * 通过 key 获取元素在虚拟列表中的尺寸范围。
     */
    getSize: GetSize;
    /**
     * Resolved align direction. For `auto` this reads `'auto'` on the first
     * measure pass (before the direction is decided) and settles to
     * `'top'`/`'bottom'` on the pass that actually positions the item.
     *
     * 已解析的对齐方向。auto 在首帧测量时仍是 'auto'，定向后变 'top'/'bottom'。
     */
    align: ScrollAlign;
}
export type ScrollOffset = number | ((info: ScrollOffsetInfo) => number);
export type ScrollTarget = {
    index: number;
    align?: ScrollAlign;
    offset?: ScrollOffset;
} | {
    key: React.Key;
    align?: ScrollAlign;
    offset?: ScrollOffset;
};
export default function useScrollTo<T>(containerRef: React.RefObject<HTMLDivElement>, data: T[], heights: CacheMap, itemHeight: number, getKey: GetKey<T>, getSize: GetSize, collectHeight: () => void, syncScrollTop: (newTop: number) => void, triggerFlash: () => void): (arg: number | ScrollTarget) => void;

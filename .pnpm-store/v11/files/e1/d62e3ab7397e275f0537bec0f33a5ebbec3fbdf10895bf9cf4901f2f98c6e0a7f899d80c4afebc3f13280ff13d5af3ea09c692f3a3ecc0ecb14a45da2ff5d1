import type { InternalMarkObj } from '../Marks';
/** Format value align with step & marks */
type FormatValue = (value: number) => number;
type OffsetMode = 'unit' | 'dist';
type IsHandleDisabled = (index: number) => boolean;
export type OffsetValues = (values: number[], offset: number | 'min' | 'max', valueIndex: number, mode?: OffsetMode) => {
    value: number;
    values: number[];
};
/**
 * Get the effective moving range for a handle.
 * Disabled handles are treated as fixed anchors, and `pushable` is applied as the gap
 * that enabled handles must keep away from those anchors.
 */
export declare const getDisabledBoundaryValues: (values: number[], valueIndex: number, min: number, max: number, pushable: false | number, isHandleDisabled: IsHandleDisabled) => [number, number];
/**
 * Find the nearest enabled handle that can accept the target value.
 * A handle is only considered when the target value falls inside its disabled-anchor
 * boundaries, so clicking outside an enabled segment becomes a no-op.
 */
export declare const getClosestEnabledHandleIndex: (values: number[], targetValue: number, min: number, max: number, pushable: false | number, isHandleDisabled: IsHandleDisabled) => number;
export default function useOffset(min: number, max: number, step: number, markList: InternalMarkObj[], allowCross: boolean, pushable: false | number, isHandleDisabled: IsHandleDisabled): [FormatValue, OffsetValues];
export {};

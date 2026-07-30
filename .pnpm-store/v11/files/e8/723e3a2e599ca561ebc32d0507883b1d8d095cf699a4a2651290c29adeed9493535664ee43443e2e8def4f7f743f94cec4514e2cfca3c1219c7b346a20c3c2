import type { StepsProps } from './index';
type StepItem = NonNullable<StepsProps['items']>[number];
type DisplayStep = {
    item: StepItem;
    originIndex: number;
};
type UseDisplayStepsResult = {
    canApplyMaxCount: boolean;
    displaySteps: DisplayStep[];
    mappedDisplayCurrent: number;
    displayItems: StepItem[];
};
/**
 * Convert the original items/current into the list consumed by rc-steps.
 * When steps are collapsed, rc-steps receives a compact item list and a remapped current,
 * while callers still interact with the original step indexes through `onChange`.
 */
export default function useDisplaySteps(mergedItems: StepItem[], current: number, initial: number, maxCount: number | undefined, prefixCls: string): UseDisplayStepsResult;
export {};

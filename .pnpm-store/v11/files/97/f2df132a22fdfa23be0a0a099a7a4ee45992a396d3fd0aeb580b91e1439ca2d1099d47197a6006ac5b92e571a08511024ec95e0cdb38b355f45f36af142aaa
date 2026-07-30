import { SliderRootContext } from "../root/SliderRootContext.js";
export interface ResolveThumbCollisionParams {
  behavior: SliderRootContext['thumbCollisionBehavior'];
  values: readonly number[];
  currentValues?: readonly number[] | null | undefined;
  initialValues?: readonly number[] | null | undefined;
  pressedIndex: number;
  nextValue: number;
  min: number;
  max: number;
  step: number;
  minStepsBetweenValues: number;
}
export interface ResolveThumbCollisionResult {
  value: number | number[];
  thumbIndex: number;
  didSwap: boolean;
}
export declare function resolveThumbCollision({
  behavior,
  values,
  currentValues,
  initialValues,
  pressedIndex,
  nextValue,
  min,
  max,
  step,
  minStepsBetweenValues
}: ResolveThumbCollisionParams): ResolveThumbCollisionResult;
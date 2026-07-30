import * as React from 'react';
import type { ProgressStatus, ProgressRootState } from "./ProgressRoot.js";
export type ProgressRootContext = {
  /**
   * Formatted value of the component.
   */
  formattedValue: string;
  /**
   * The maximum value.
   */
  max: number;
  /**
   * The minimum value.
   */
  min: number;
  /**
   * Value of the component.
   */
  value: number | null;
  setLabelId: React.Dispatch<React.SetStateAction<string | undefined>>;
  state: ProgressRootState;
  status: ProgressStatus;
};
/**
 * @internal
 */
export declare const ProgressRootContext: React.Context<ProgressRootContext | undefined>;
export declare function useProgressRootContext(): ProgressRootContext;
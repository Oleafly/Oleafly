import * as React from 'react';
export interface UseCompositeListItemParameters<Metadata> {
  index?: number | undefined;
  label?: string | null | undefined;
  metadata?: Metadata | undefined;
  textRef?: React.RefObject<HTMLElement | null> | undefined;
  /** Enables guessing the indexes. This avoids a re-render after mount, which is useful for
   * large lists. This should be used for lists that are likely flat and vertical, other cases
   * might trigger a re-render anyway. */
  indexGuessBehavior?: IndexGuessBehavior | undefined;
}
interface UseCompositeListItemReturnValue {
  ref: (node: HTMLElement | null) => void;
  index: number;
}
export declare enum IndexGuessBehavior {
  None = 0,
  GuessFromOrder = 1,
}
/**
 * Used to register a list item and its index (DOM position) in the `CompositeList`.
 */
export declare function useCompositeListItem<Metadata>(params?: UseCompositeListItemParameters<Metadata>): UseCompositeListItemReturnValue;
export {};
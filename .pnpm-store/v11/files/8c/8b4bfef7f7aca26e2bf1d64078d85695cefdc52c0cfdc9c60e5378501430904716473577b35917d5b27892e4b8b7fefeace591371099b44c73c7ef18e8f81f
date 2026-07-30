import * as React from 'react';
export interface CompositeListContextValue<Metadata> {
  register: (node: Element, metadata: Metadata) => void;
  unregister: (node: Element) => void;
  subscribeMapChange: (fn: (map: Map<Element, Metadata | null>) => void) => () => void;
  elementsRef: React.RefObject<Array<HTMLElement | null>>;
  labelsRef?: React.RefObject<Array<string | null>> | undefined;
  nextIndexRef: React.RefObject<number>;
}
export declare const CompositeListContext: React.Context<CompositeListContextValue<any>>;
export declare function useCompositeListContext(): CompositeListContextValue<any>;
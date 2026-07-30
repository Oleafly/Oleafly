import * as React from 'react';
import { Store } from "./Store.js";
export interface StoreInspectorProps {
  /**
   * Instance of the store to inspect.
   */
  store: Store<any>;
  /**
   * Additional data to display in the inspector.
   */
  additionalData?: any;
  /**
   * Title to display in the panel header.
   */
  title?: string | undefined;
  /**
   * Whether the inspector panel should be open by default.
   * @default false
   */
  defaultOpen?: boolean | undefined;
}
/**
 * A tool to inspect the state of a Store in a floating panel.
 * This is intended for development and debugging purposes.
 */
export declare function StoreInspector(props: StoreInspectorProps): import("react/jsx-runtime").JSX.Element;
interface PanelProps {
  anchorElement: HTMLElement | null;
  store: Store<any>;
  title?: string | undefined;
  additionalData?: any;
  open: boolean;
  onClose?: (() => void) | undefined;
}
export declare function StoreInspectorPanel({
  anchorElement,
  store,
  title,
  additionalData,
  open,
  onClose
}: PanelProps): React.ReactPortal | null;
export {};
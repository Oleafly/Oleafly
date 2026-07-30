import { ToastAPI, ToastPosition } from "./type.mjs";
//#region src/base-ui/Toast/imperative.d.ts
declare const toast: ToastAPI;
interface ToastHostProps {
  className?: string;
  /**
   * Default duration for toasts
   * @default 5000
   */
  duration?: number;
  /**
   * Maximum number of toasts
   * @default 5
   */
  limit?: number;
  /**
   * Toast position
   * @default 'bottom-right'
   */
  position?: ToastPosition;
  /**
   * Root element for portal
   */
  root?: HTMLElement | ShadowRoot | null;
  /**
   * Swipe direction to dismiss
   * @default ['down', 'right']
   */
  swipeDirection?: ('left' | 'right' | 'up' | 'down') | ('left' | 'right' | 'up' | 'down')[];
}
declare const ToastHost: import("react").MemoExoticComponent<({ root, className, duration, limit, position, swipeDirection }: ToastHostProps) => import("react").JSX.Element[] | null>;
declare const useToast: () => ToastAPI;
//#endregion
export { ToastHost, ToastHostProps, toast, useToast };
//# sourceMappingURL=imperative.d.mts.map
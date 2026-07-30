import { ModalRootProps } from "../Modal/atoms.mjs";
import "../Modal/index.mjs";
import { CSSProperties, ReactNode } from "react";
import { MotionProps } from "motion/react";
//#region src/base-ui/FloatingPanel/type.d.ts
type FloatingPanelPlacement = 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
type FloatingPanelOffset = number | string | {
  x?: number | string;
  y?: number | string;
};
interface FloatingPanelSize {
  height: number;
  width: number;
}
interface FloatingPanelProps {
  actions?: ReactNode;
  afterClose?: () => void;
  ariaLabel?: string;
  children?: ReactNode;
  className?: string;
  classNames?: {
    backdrop?: string;
    actions?: string;
    body?: string;
    close?: string;
    footer?: string;
    header?: string;
    panel?: string;
    resizeHandle?: string;
    title?: string;
    wrapper?: string;
  };
  closable?: boolean;
  closeIcon?: ReactNode;
  closeLabel?: string;
  defaultOpen?: boolean;
  footer?: ReactNode;
  getContainer?: false | HTMLElement | null;
  height?: number | string;
  keyboard?: boolean;
  mask?: boolean;
  maskClosable?: boolean;
  maxHeight?: number;
  maxWidth?: number;
  minHeight?: number;
  minWidth?: number;
  modal?: boolean;
  motionProps?: MotionProps;
  offset?: FloatingPanelOffset;
  onClose?: () => void;
  onOpenChange?: ModalRootProps['onOpenChange'];
  onResize?: (size: FloatingPanelSize) => void;
  onResizeEnd?: (size: FloatingPanelSize) => void;
  open?: boolean;
  placement?: FloatingPanelPlacement;
  resizable?: boolean;
  styles?: {
    actions?: CSSProperties;
    backdrop?: CSSProperties;
    body?: CSSProperties;
    close?: CSSProperties;
    footer?: CSSProperties;
    header?: CSSProperties;
    panel?: CSSProperties;
    resizeHandle?: CSSProperties;
    title?: CSSProperties;
    wrapper?: CSSProperties;
  };
  title?: ReactNode;
  width?: number | string;
  zIndex?: number;
}
//#endregion
export { FloatingPanelOffset, FloatingPanelPlacement, FloatingPanelProps, FloatingPanelSize };
//# sourceMappingURL=type.d.mts.map
import { ButtonProps } from "../Button/type.mjs";
import "../Button/index.mjs";
import { CSSProperties, MouseEvent, ReactNode } from "react";
//#region src/base-ui/Modal/type.d.ts
interface BaseModalProps {
  children?: ReactNode;
  className?: string;
  classNames?: {
    backdrop?: string;
    close?: string;
    content?: string;
    footer?: string;
    header?: string;
    popup?: string;
    title?: string;
  };
  maskClosable?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  open?: boolean;
  styles?: {
    backdrop?: CSSProperties;
    close?: CSSProperties;
    content?: CSSProperties;
    footer?: CSSProperties;
    header?: CSSProperties;
    popup?: CSSProperties;
    title?: CSSProperties;
  };
  title?: ReactNode;
  width?: number | string;
}
interface ModalContextValue {
  close: () => void;
  setCanDismissByClickOutside: (value: boolean) => void;
}
interface ModalInstance extends ModalContextValue {
  destroy: () => void;
  update: (nextProps: Partial<BaseModalProps>) => void;
}
type ImperativeModalProps = BaseModalProps & {
  content?: ReactNode;
  footer?: ReactNode;
};
type ModalButtonProps = ButtonProps;
interface ModalComponentProps {
  afterClose?: () => void;
  afterOpenChange?: (open: boolean) => void;
  allowFullscreen?: boolean;
  cancelButtonProps?: ModalButtonProps;
  cancelText?: ReactNode;
  centered?: boolean;
  children?: ReactNode;
  className?: string;
  classNames?: {
    body?: string;
    footer?: string;
    header?: string;
    mask?: string;
    title?: string;
    wrapper?: string;
  };
  closable?: boolean;
  closeIcon?: ReactNode;
  confirmLoading?: boolean;
  destroyOnHidden?: boolean;
  draggable?: boolean;
  footer?: ReactNode | false | null | ((originNode: ReactNode, extra: {
    CancelBtn: React.FC;
    OkBtn: React.FC;
  }) => ReactNode);
  getContainer?: HTMLElement | false | null;
  height?: number | string;
  keyboard?: boolean;
  loading?: boolean;
  mask?: boolean;
  maskClosable?: boolean;
  okButtonProps?: ModalButtonProps;
  okText?: ReactNode;
  onCancel?: (e: MouseEvent<HTMLButtonElement>) => void;
  onOk?: (e: MouseEvent<HTMLButtonElement>) => void;
  open?: boolean;
  style?: CSSProperties;
  styles?: {
    body?: CSSProperties;
    footer?: CSSProperties;
    header?: CSSProperties;
    mask?: CSSProperties;
    title?: CSSProperties;
    wrapper?: CSSProperties;
  };
  title?: ReactNode | false;
  width?: number | string;
  zIndex?: number;
}
interface ModalConfirmConfig {
  cancelText?: ReactNode;
  content?: ReactNode;
  okButtonProps?: ModalButtonProps;
  okText?: ReactNode;
  onCancel?: () => void;
  onOk?: (() => void) | (() => Promise<void>);
  title?: ReactNode;
}
//#endregion
export { BaseModalProps, ImperativeModalProps, ModalComponentProps, ModalConfirmConfig, ModalContextValue, ModalInstance };
//# sourceMappingURL=type.d.mts.map
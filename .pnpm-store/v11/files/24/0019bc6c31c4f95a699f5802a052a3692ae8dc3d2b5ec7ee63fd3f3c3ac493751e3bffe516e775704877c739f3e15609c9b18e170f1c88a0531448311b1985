import { ComponentType } from "react";
import { ModalProps } from "antd";
//#region src/Modal/type.d.ts
type ModalProps$1 = Omit<ModalProps, 'okType' | 'wrapClassName'> & {
  allowFullscreen?: boolean;
  enableResponsive?: boolean;
  paddings?: {
    desktop?: number;
    mobile?: number;
  };
};
type ModalContextValue = {
  close: () => void;
  setCanDismissByClickOutside: (value: boolean) => void;
};
type ModalInstance = ModalContextValue & {
  destroy: () => void;
  update: (nextProps: Partial<ImperativeModalProps>) => void;
};
type ImperativeModalProps = ModalProps$1;
type RawModalComponentProps = {
  onClose: () => void;
  open: boolean;
};
type RawModalComponent<P = any> = ComponentType<P>;
type RawModalOptions<OpenKey extends PropertyKey = 'open', CloseKey extends PropertyKey = 'onClose'> = {
  destroyDelay?: number;
  destroyOnClose?: boolean;
  onCloseKey?: CloseKey;
  openKey?: OpenKey;
};
type RawModalKeyOptions<OpenKey extends PropertyKey = 'open', CloseKey extends PropertyKey = 'onClose'> = RawModalOptions<OpenKey, CloseKey> & {
  onCloseKey: CloseKey;
  openKey: OpenKey;
};
type RawModalInstance<P = any, OpenKey extends PropertyKey = 'open', CloseKey extends PropertyKey = 'onClose'> = ModalContextValue & {
  destroy: () => void;
  update: (nextProps: Partial<Omit<P, Extract<OpenKey, keyof P> | Extract<CloseKey, keyof P>>>) => void;
};
//#endregion
export { ImperativeModalProps, ModalContextValue, ModalInstance, ModalProps$1 as ModalProps, RawModalComponent, RawModalComponentProps, RawModalInstance, RawModalKeyOptions, RawModalOptions };
//# sourceMappingURL=type.d.mts.map
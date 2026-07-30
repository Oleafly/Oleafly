import { ImperativeModalProps, ModalConfirmConfig, ModalInstance } from "./type.mjs";
//#region src/base-ui/Modal/imperative.d.ts
interface ModalHostProps {
  root?: HTMLElement | ShadowRoot | null;
}
interface ModalSystem {
  confirmModal: (config: ModalConfirmConfig) => {
    close: () => void;
    destroy: () => void;
  };
  createModal: (props: ImperativeModalProps) => ModalInstance;
  ModalHost: React.FC<ModalHostProps>;
}
declare function createModalSystem(): ModalSystem;
declare const ModalHost: import("react").FC<ModalHostProps>;
declare const createModal: (props: ImperativeModalProps) => ModalInstance;
declare const confirmModal: (config: ModalConfirmConfig) => {
  close: () => void;
  destroy: () => void;
};
//#endregion
export { ModalHost, ModalHostProps, ModalSystem, confirmModal, createModal, createModalSystem };
//# sourceMappingURL=imperative.d.mts.map
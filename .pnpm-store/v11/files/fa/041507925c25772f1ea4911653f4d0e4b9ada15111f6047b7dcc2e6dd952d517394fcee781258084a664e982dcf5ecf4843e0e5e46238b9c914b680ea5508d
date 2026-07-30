import { ImperativeModalProps, ModalInstance, RawModalComponent, RawModalComponentProps, RawModalInstance, RawModalKeyOptions, RawModalOptions } from "./type.mjs";
//#region src/Modal/imperative.d.ts
type ModalHostProps = {
  root?: HTMLElement | ShadowRoot | null;
};
declare const ModalHost: ({ root }: ModalHostProps) => import("react").JSX.Element | null;
declare const createModal: (props: ImperativeModalProps) => ModalInstance;
declare function createRawModal<P extends RawModalComponentProps>(component: RawModalComponent<P>, props: Omit<P, 'open' | 'onClose'>, options?: RawModalOptions): RawModalInstance<P>;
declare function createRawModal<P, OpenKey extends keyof P, CloseKey extends keyof P>(component: RawModalComponent<P>, props: Omit<P, OpenKey | CloseKey>, options: RawModalKeyOptions<OpenKey, CloseKey>): RawModalInstance<P, OpenKey, CloseKey>;
//#endregion
export { ModalHost, ModalHostProps, createModal, createRawModal };
//# sourceMappingURL=imperative.d.mts.map
import React from "react";
import { Dialog } from "@base-ui/react/dialog";
//#region src/base-ui/Modal/atoms.d.ts
interface ModalAnimationActions {
  onExitComplete: () => void;
}
declare const useModalOpen: () => boolean | null;
declare const useModalActions: () => ModalAnimationActions | null;
type ModalRootProps = Dialog.Root.Props & {
  onExitComplete?: () => void;
  zIndex?: number;
};
declare const ModalRoot: ({ open, onExitComplete, ...rest }: ModalRootProps) => React.JSX.Element;
type ModalPortalProps = React.ComponentProps<typeof Dialog.Portal> & {
  container?: HTMLElement | null;
};
declare const ModalPortal: ({ container, ...rest }: ModalPortalProps) => React.JSX.Element;
type ModalViewportProps = React.ComponentProps<typeof Dialog.Viewport>;
declare const ModalViewport: ({ className, ...rest }: ModalViewportProps) => React.JSX.Element;
type ModalBackdropProps = React.ComponentProps<typeof Dialog.Backdrop>;
declare const ModalBackdrop: ({ className, style, ...rest }: ModalBackdropProps) => React.JSX.Element;
type ModalPopupProps = React.ComponentProps<typeof Dialog.Popup> & {
  motionProps?: Record<string, any>;
  panelClassName?: string;
  popupStyle?: React.CSSProperties;
  width?: number | string;
};
declare const ModalPopup: ({ className, children, width, style, motionProps, panelClassName, popupStyle, ref: forwardedRef, ...rest }: ModalPopupProps) => React.JSX.Element;
type ModalHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
};
declare const ModalHeader: ({ className, ...rest }: ModalHeaderProps) => React.JSX.Element;
type ModalTitleProps = React.ComponentProps<typeof Dialog.Title>;
declare const ModalTitle: ({ className, ...rest }: ModalTitleProps) => React.JSX.Element;
type ModalDescriptionProps = React.ComponentProps<typeof Dialog.Description>;
declare const ModalDescription: React.FC<ModalDescriptionProps>;
type ModalContentProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
};
declare const ModalContent: ({ className, ...rest }: ModalContentProps) => React.JSX.Element;
type ModalFooterProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
};
declare const ModalFooter: ({ className, ...rest }: ModalFooterProps) => React.JSX.Element;
type ModalCloseProps = React.ComponentProps<typeof Dialog.Close>;
declare const ModalClose: ({ className, children, ...rest }: ModalCloseProps) => React.JSX.Element;
type ModalTriggerProps = Omit<React.ComponentPropsWithRef<typeof Dialog.Trigger>, 'children' | 'render'> & {
  children?: React.ReactNode;
  nativeButton?: boolean;
};
declare const ModalTrigger: ({ children, className, nativeButton, ref: refProp, ...rest }: ModalTriggerProps) => React.JSX.Element;
//#endregion
export { ModalBackdrop, ModalBackdropProps, ModalClose, ModalCloseProps, ModalContent, ModalContentProps, ModalDescription, ModalDescriptionProps, ModalFooter, ModalFooterProps, ModalHeader, ModalHeaderProps, ModalPopup, ModalPopupProps, ModalPortal, ModalPortalProps, ModalRoot, ModalRootProps, ModalTitle, ModalTitleProps, ModalTrigger, ModalTriggerProps, ModalViewport, ModalViewportProps, useModalActions, useModalOpen };
//# sourceMappingURL=atoms.d.mts.map
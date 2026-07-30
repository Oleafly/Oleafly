import * as React from 'react';
import type { ConfigUpdate } from '../confirm';
import type { ModalFuncProps } from '../interface';
export interface HookModalProps {
    afterClose: () => void;
    config: ModalFuncProps;
    onConfirm?: (confirmed: boolean) => void;
    /**
     * Do not throw if is await mode
     */
    isSilent?: () => boolean;
}
export interface HookModalRef {
    destroy: () => void;
    update: (config: ConfigUpdate) => void;
}
declare const HookModal: React.ForwardRefExoticComponent<HookModalProps & React.RefAttributes<HookModalRef>>;
export default HookModal;

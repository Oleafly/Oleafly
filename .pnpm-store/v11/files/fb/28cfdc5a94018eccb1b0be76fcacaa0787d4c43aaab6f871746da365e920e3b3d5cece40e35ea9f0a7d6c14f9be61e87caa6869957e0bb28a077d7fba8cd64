import * as React from 'react';
import type { PopoverProps, PopoverSemanticAllType } from '.';
interface OverlayProps {
    prefixCls?: string;
    title?: React.ReactNode;
    content?: React.ReactNode;
    classNames?: PopoverSemanticAllType['classNames'];
    styles?: PopoverSemanticAllType['styles'];
}
export declare const Overlay: React.FC<OverlayProps>;
export interface PurePanelProps extends Omit<PopoverProps, 'children'> {
    children?: React.ReactNode;
}
interface RawPurePanelProps extends PopoverProps {
    hashId: string;
}
export declare const RawPurePanel: React.FC<RawPurePanelProps>;
declare const PurePanel: React.FC<PurePanelProps>;
export default PurePanel;

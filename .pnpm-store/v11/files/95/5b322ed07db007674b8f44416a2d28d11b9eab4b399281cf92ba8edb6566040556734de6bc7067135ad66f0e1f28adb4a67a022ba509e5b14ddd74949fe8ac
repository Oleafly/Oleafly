import * as React from 'react';
import type { CSSMotionRef } from '@rc-component/motion';
import type { PanelProps, PanelRef } from './Panel';
export type CSSMotionStateRef = Pick<CSSMotionRef, 'inMotion' | 'enableMotion'>;
export type ContentRef = PanelRef & CSSMotionStateRef;
export type ContentProps = {
    motionName: string;
    ariaId: string;
    onVisibleChanged: (visible: boolean) => void;
} & PanelProps;
declare const Content: React.ForwardRefExoticComponent<{
    motionName: string;
    ariaId: string;
    onVisibleChanged: (visible: boolean) => void;
} & PanelProps & React.RefAttributes<ContentRef>>;
export default Content;

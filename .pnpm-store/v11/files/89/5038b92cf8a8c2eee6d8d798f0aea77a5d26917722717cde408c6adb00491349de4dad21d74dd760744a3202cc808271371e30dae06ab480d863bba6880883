import * as React from 'react';
import { Panel } from '@rc-component/dialog';
import type { ModalFuncProps, ModalSemanticAllType } from './interface';
type PanelProps = React.ComponentPropsWithoutRef<typeof Panel>;
export interface PurePanelProps extends Omit<PanelProps, 'prefixCls' | 'footer' | 'classNames' | 'styles'>, Pick<ModalFuncProps, 'type' | 'footer'> {
    prefixCls?: string;
    style?: React.CSSProperties;
    classNames?: ModalSemanticAllType['classNames'];
    styles?: ModalSemanticAllType['styles'];
}
declare const _default: (props: PurePanelProps) => React.JSX.Element;
export default _default;

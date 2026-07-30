import * as React from 'react';
import type { NotificationProps as RcNotificationProps } from '@rc-component/notification';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { IconType, NotificationSemanticType } from './interface';
export type AnchorSemanticAllType = GenerateSemantic<NotificationSemanticType, PurePanelProps>;
export declare const TypeIcon: {
    info: React.JSX.Element;
    success: React.JSX.Element;
    error: React.JSX.Element;
    warning: React.JSX.Element;
    loading: React.JSX.Element;
};
export declare function getCloseIcon(prefixCls: string, closeIcon?: React.ReactNode): React.ReactNode;
export interface PurePanelProps extends Omit<RcNotificationProps, 'prefixCls' | 'classNames' | 'styles' | 'title' | 'description' | 'icon' | 'actions' | 'role'> {
    prefixCls?: string;
    icon?: React.ReactNode;
    /** @deprecated Please use `title` instead */
    message?: React.ReactNode;
    title?: React.ReactNode;
    description?: React.ReactNode;
    /** @deprecated Please use `actions` instead */
    btn?: React.ReactNode;
    actions?: React.ReactNode;
    type?: IconType;
    role?: 'alert' | 'status';
    classNames?: AnchorSemanticAllType['classNamesAndFn'];
    styles?: AnchorSemanticAllType['stylesAndFn'];
    closeIcon?: React.ReactNode;
}
/** @private Internal Component. Do not use in your production. */
declare const PurePanel: React.FC<PurePanelProps>;
export default PurePanel;

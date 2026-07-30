import * as React from 'react';
import type { NotificationProps as RcNotificationProps } from '@rc-component/notification';
import type { MessageSemanticAllType, NoticeType } from './interface';
export declare const TypeIcon: {
    info: React.JSX.Element;
    success: React.JSX.Element;
    error: React.JSX.Element;
    warning: React.JSX.Element;
    loading: React.JSX.Element;
};
export declare const getMessageIcon: (type?: NoticeType, icon?: React.ReactNode) => string | number | bigint | true | Iterable<React.ReactNode> | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | null | undefined> | React.JSX.Element | null;
export interface MessageContentProps {
    type?: NoticeType;
    icon?: React.ReactNode;
}
export interface PurePanelProps extends Omit<RcNotificationProps, 'prefixCls' | 'classNames' | 'styles' | 'title' | 'description' | 'icon' | 'actions'>, MessageContentProps {
    prefixCls?: string;
    content?: React.ReactNode;
    classNames?: MessageSemanticAllType['classNamesAndFn'];
    styles?: MessageSemanticAllType['stylesAndFn'];
}
/** @private Internal Component. Do not use in your production. */
declare const PurePanel: React.FC<PurePanelProps>;
export default PurePanel;

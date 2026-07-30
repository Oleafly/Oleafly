import * as React from 'react';
import type { ReactElement } from 'react';
import type { CSSMotionProps } from '@rc-component/motion';
import { type NotificationClassNames, type NotificationListConfig, type NotificationStyles, type Placement, type StackConfig } from './NotificationList';
import type { ComponentsType } from './Notification';
export interface NotificationsProps {
    prefixCls?: string;
    classNames?: NotificationClassNames;
    styles?: NotificationStyles;
    components?: ComponentsType;
    className?: (placement: Placement) => string;
    style?: (placement: Placement) => React.CSSProperties;
    container?: HTMLElement | ShadowRoot;
    motion?: CSSMotionProps | ((placement: Placement) => CSSMotionProps);
    maxCount?: number;
    pauseOnHover?: boolean;
    stack?: boolean | StackConfig;
    onAllRemoved?: VoidFunction;
    renderNotifications?: (node: ReactElement, info: {
        prefixCls: string;
        key: React.Key;
    }) => ReactElement;
}
export interface NotificationsRef {
    open: (config: NotificationListConfig) => void;
    close: (key: React.Key) => void;
    destroy: () => void;
}
declare const Notifications: React.ForwardRefExoticComponent<NotificationsProps & React.RefAttributes<NotificationsRef>>;
export default Notifications;

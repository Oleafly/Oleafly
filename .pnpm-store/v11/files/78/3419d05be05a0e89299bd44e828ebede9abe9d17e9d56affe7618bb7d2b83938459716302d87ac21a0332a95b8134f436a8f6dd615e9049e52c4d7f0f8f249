import type { CSSMotionProps } from '@rc-component/motion';
import * as React from 'react';
import { type StackConfig } from '../hooks/useStack';
import { type ComponentsType, type NotificationClassNames as NoticeClassNames, type NotificationProps, type NotificationStyles as NoticeStyles } from '../Notification';
export type Placement = 'top' | 'topLeft' | 'topRight' | 'bottom' | 'bottomLeft' | 'bottomRight';
export type { StackConfig } from '../hooks/useStack';
export interface NotificationListConfig extends Omit<NotificationProps, 'prefixCls'> {
    key: React.Key;
    placement?: Placement;
    times?: number;
}
export interface NotificationClassNames extends NoticeClassNames {
    list?: string;
    listContent?: string;
}
export interface NotificationStyles extends NoticeStyles {
    list?: React.CSSProperties;
    listContent?: React.CSSProperties;
}
export interface NotificationListProps {
    configList?: NotificationListConfig[];
    prefixCls?: string;
    placement: Placement;
    pauseOnHover?: boolean;
    classNames?: NotificationClassNames;
    styles?: NotificationStyles;
    components?: ComponentsType;
    stack?: boolean | StackConfig;
    motion?: CSSMotionProps | ((placement: Placement) => CSSMotionProps);
    className?: string;
    style?: React.CSSProperties;
    onNoticeClose?: (key: React.Key) => void;
    onAllRemoved?: (placement: Placement) => void;
}
declare const NotificationList: React.FC<NotificationListProps>;
export default NotificationList;

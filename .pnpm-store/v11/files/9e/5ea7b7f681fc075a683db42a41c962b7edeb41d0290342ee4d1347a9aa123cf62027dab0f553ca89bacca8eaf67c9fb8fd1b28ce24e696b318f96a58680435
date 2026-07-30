import * as React from 'react';
import { type ClosableType } from './hooks/useClosable';
import type { NotificationProgressProps } from './Progress';
export interface NotificationClassNames {
    wrapper?: string;
    root?: string;
    icon?: string;
    section?: string;
    title?: string;
    description?: string;
    actions?: string;
    close?: string;
    progress?: string;
}
export interface NotificationStyles {
    wrapper?: React.CSSProperties;
    root?: React.CSSProperties;
    icon?: React.CSSProperties;
    section?: React.CSSProperties;
    title?: React.CSSProperties;
    description?: React.CSSProperties;
    actions?: React.CSSProperties;
    close?: React.CSSProperties;
    progress?: React.CSSProperties;
}
export interface ComponentsType {
    progress?: React.ComponentType<NotificationProgressProps>;
}
export interface NotificationProps {
    prefixCls: string;
    className?: string;
    style?: React.CSSProperties;
    classNames?: NotificationClassNames;
    styles?: NotificationStyles;
    components?: ComponentsType;
    title?: React.ReactNode;
    description?: React.ReactNode;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
    role?: string;
    closable?: ClosableType;
    offset?: number;
    notificationIndex?: number;
    stackInThreshold?: boolean;
    props?: React.HTMLAttributes<HTMLDivElement> & Record<string, any>;
    duration?: number | false | null;
    showProgress?: boolean;
    times?: number;
    hovering?: boolean;
    pauseOnHover?: boolean;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
    /** @deprecated Please use `closable.onClose` instead. */
    onClose?: () => void;
}
declare const Notification: React.ForwardRefExoticComponent<NotificationProps & React.RefAttributes<HTMLDivElement>>;
export default Notification;

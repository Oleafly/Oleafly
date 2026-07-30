import * as React from 'react';
import { type NotificationsProps } from '../Notifications';
import type { NotificationListConfig } from '../NotificationList';
import type { Placement } from '../NotificationList';
type OptionalConfig = Partial<NotificationListConfig>;
export interface NotificationConfig extends Omit<NotificationsProps, 'container'> {
    placement?: Placement;
    getContainer?: () => HTMLElement | ShadowRoot;
    closable?: NotificationListConfig['closable'];
    duration?: number | false | null;
    showProgress?: NotificationListConfig['showProgress'];
}
export interface NotificationAPI {
    open: (config: OptionalConfig) => void;
    close: (key: React.Key) => void;
    destroy: () => void;
}
/**
 * Creates the notification API and the React holder element.
 * Queueing is handled internally until the notification instance is ready.
 */
export default function useNotification(rootConfig?: NotificationConfig): [NotificationAPI, React.ReactElement];
export {};

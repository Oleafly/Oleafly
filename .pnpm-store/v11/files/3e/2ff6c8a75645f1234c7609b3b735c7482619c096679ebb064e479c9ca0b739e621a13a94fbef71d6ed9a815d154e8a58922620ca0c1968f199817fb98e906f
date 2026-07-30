import * as React from 'react';
import type { IconType, NotificationPlacement, NotificationSemanticAllType } from './interface';
interface PureListItem {
    key: React.Key;
    title: React.ReactNode;
    description: React.ReactNode;
    type: IconType;
    actions?: React.ReactNode;
    duration?: number | false;
    showProgress?: boolean;
}
export interface PureListProps {
    items: PureListItem[];
    placement?: NotificationPlacement;
    classNames?: NotificationSemanticAllType['classNames'];
    style?: React.CSSProperties;
}
/** @private Internal Component. Do not use in your production. */
declare const PureList: React.FC<PureListProps>;
export default PureList;

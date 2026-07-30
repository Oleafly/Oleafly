import * as React from 'react';
import type { EditableConfig, Tab, TabsLocale, MoreProps } from '../interface';
import type { SemanticName } from '../Tabs';
export interface OperationNodeProps {
    prefixCls: string;
    className?: string;
    style?: React.CSSProperties;
    id: string;
    tabs: Tab[];
    rtl: boolean;
    tabBarGutter?: number;
    activeKey: string;
    mobile: boolean;
    more?: MoreProps;
    editable?: EditableConfig;
    locale?: TabsLocale;
    removeAriaLabel?: string;
    onTabClick: (key: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    tabMoving?: boolean;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
    popupClassName?: string;
    popupStyle?: React.CSSProperties;
    styles?: Pick<Partial<Record<SemanticName, React.CSSProperties>>, 'remove'>;
    classNames?: Pick<Partial<Record<SemanticName, string>>, 'remove'>;
}
declare const _default: React.MemoExoticComponent<React.ForwardRefExoticComponent<OperationNodeProps & React.RefAttributes<HTMLDivElement>>>;
export default _default;

import * as React from 'react';
import type { EditableConfig, Tab } from '../interface';
import type { SemanticName } from '../Tabs';
export interface TabNodeProps {
    id: string;
    prefixCls: string;
    tab: Tab;
    active: boolean;
    focus: boolean;
    closable?: boolean;
    editable?: EditableConfig;
    onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
    onResize?: (width: number, height: number, left: number, top: number) => void;
    renderWrapper?: (node: React.ReactElement) => React.ReactElement;
    removeAriaLabel?: string;
    tabCount: number;
    currentPosition: number;
    removeIcon?: React.ReactNode;
    onKeyDown: React.KeyboardEventHandler;
    onMouseDown: React.MouseEventHandler;
    onMouseUp: React.MouseEventHandler;
    onFocus: React.FocusEventHandler;
    onBlur: React.FocusEventHandler;
    styles?: Pick<Partial<Record<SemanticName, React.CSSProperties>>, 'item' | 'remove'>;
    classNames?: Pick<Partial<Record<SemanticName, string>>, 'item' | 'remove'>;
}
declare const TabNode: React.FC<TabNodeProps>;
export default TabNode;

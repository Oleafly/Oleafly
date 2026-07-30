import * as React from 'react';
import type { RenderFunction } from '../_util/getRenderPropValue';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { ButtonProps, LegacyButtonType } from '../button/Button';
import type { PopoverSemanticType } from '../popover';
import type { AbstractTooltipProps, TooltipRef } from '../tooltip';
import PurePanel from './PurePanel';
export type PopconfirmSemanticType = {
    classNames?: PopoverSemanticType['classNames'] & {
        icon?: string;
    };
    styles?: PopoverSemanticType['styles'] & {
        icon?: React.CSSProperties;
    };
};
export type PopconfirmSemanticAllType = GenerateSemantic<PopconfirmSemanticType, PopconfirmProps>;
export interface PopconfirmProps extends AbstractTooltipProps {
    title: React.ReactNode | RenderFunction;
    description?: React.ReactNode | RenderFunction;
    disabled?: boolean;
    onConfirm?: (e?: React.MouseEvent<HTMLElement>) => void;
    onCancel?: (e?: React.MouseEvent<HTMLElement>) => void;
    okText?: React.ReactNode;
    okType?: LegacyButtonType;
    cancelText?: React.ReactNode;
    okButtonProps?: ButtonProps;
    cancelButtonProps?: ButtonProps;
    showCancel?: boolean;
    icon?: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
    onPopupClick?: (e: React.MouseEvent<HTMLElement>) => void;
    classNames?: PopconfirmSemanticAllType['classNamesAndFn'];
    styles?: PopconfirmSemanticAllType['stylesAndFn'];
}
export interface PopconfirmState {
    open?: boolean;
}
declare const InternalPopconfirm: React.ForwardRefExoticComponent<PopconfirmProps & React.RefAttributes<TooltipRef>>;
type CompoundedComponent = typeof InternalPopconfirm & {
    _InternalPanelDoNotUseOrYouWillBeFired: typeof PurePanel;
};
declare const Popconfirm: CompoundedComponent;
export default Popconfirm;

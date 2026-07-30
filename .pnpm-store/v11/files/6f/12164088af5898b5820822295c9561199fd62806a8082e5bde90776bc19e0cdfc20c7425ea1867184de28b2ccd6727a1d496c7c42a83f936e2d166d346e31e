import * as React from 'react';
import type { RenderFunction } from '../_util/getRenderPropValue';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { AbstractTooltipProps, TooltipRef, TooltipSemanticAllType } from '../tooltip';
import PurePanel from './PurePanel';
export type PopoverSemanticType = {
    classNames?: {
        title?: string;
        content?: string;
    } & TooltipSemanticAllType['classNames'];
    styles?: {
        title?: React.CSSProperties;
        content?: React.CSSProperties;
    } & TooltipSemanticAllType['styles'];
};
export type PopoverSemanticAllType = GenerateSemantic<PopoverSemanticType, PopoverProps>;
export interface PopoverProps extends AbstractTooltipProps {
    title?: React.ReactNode | RenderFunction;
    content?: React.ReactNode | RenderFunction;
    onOpenChange?: (open: boolean) => void;
    classNames?: PopoverSemanticAllType['classNamesAndFn'];
    styles?: PopoverSemanticAllType['stylesAndFn'];
}
declare const InternalPopover: React.ForwardRefExoticComponent<PopoverProps & React.RefAttributes<TooltipRef>>;
type CompoundedComponent = typeof InternalPopover & {
    _InternalPanelDoNotUseOrYouWillBeFired: typeof PurePanel;
};
declare const Popover: CompoundedComponent;
export default Popover;

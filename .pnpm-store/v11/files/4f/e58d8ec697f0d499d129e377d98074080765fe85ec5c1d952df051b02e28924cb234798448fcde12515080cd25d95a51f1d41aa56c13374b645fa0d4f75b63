import React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { BadgeProps } from '../badge';
import type { ButtonSemanticType } from '../button/Button';
import type { ButtonHTMLType } from '../button/buttonHelpers';
import type { TooltipProps } from '../tooltip';
import type BackTop from './BackTop';
import type FloatButtonGroup from './FloatButtonGroup';
import type PurePanel from './PurePanel';
export type FloatButtonElement = HTMLAnchorElement & HTMLButtonElement;
export interface FloatButtonRef {
    nativeElement: FloatButtonElement | null;
}
export type FloatButtonType = 'default' | 'primary';
export type FloatButtonShape = 'circle' | 'square';
export type FloatButtonGroupTrigger = 'click' | 'hover';
export type FloatButtonBadgeProps = Omit<BadgeProps, 'status' | 'text' | 'title' | 'children'>;
export type FloatButtonSemanticType = ButtonSemanticType;
export type FloatButtonSemanticAllType = GenerateSemantic<FloatButtonSemanticType, FloatButtonProps>;
export interface FloatButtonProps extends React.DOMAttributes<FloatButtonElement> {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    classNames?: FloatButtonSemanticAllType['classNamesAndFn'];
    styles?: FloatButtonSemanticAllType['stylesAndFn'];
    icon?: React.ReactNode;
    /** @deprecated Please use `content` instead. */
    description?: React.ReactNode;
    content?: React.ReactNode;
    type?: FloatButtonType;
    shape?: FloatButtonShape;
    tooltip?: React.ReactNode | TooltipProps;
    href?: string;
    target?: React.HTMLAttributeAnchorTarget;
    badge?: FloatButtonBadgeProps;
    disabled?: boolean;
    /**
     * @since 5.21.0
     * @default button
     */
    htmlType?: ButtonHTMLType;
    'aria-label'?: React.HtmlHTMLAttributes<HTMLElement>['aria-label'];
}
export declare const floatButtonPrefixCls = "float-btn";
declare const InternalFloatButton: React.ForwardRefExoticComponent<FloatButtonProps & React.RefAttributes<FloatButtonElement>>;
type CompoundedComponent = typeof InternalFloatButton & {
    Group: typeof FloatButtonGroup;
    BackTop: typeof BackTop;
    _InternalPanelDoNotUseOrYouWillBeFired: typeof PurePanel;
};
declare const FloatButton: CompoundedComponent;
export default FloatButton;

import * as react_jsx_runtime from 'react/jsx-runtime';
import * as _radix_ui_react_context from '@radix-ui/react-context';
import { Scope } from '@radix-ui/react-context';
import * as React from 'react';
import { DismissableLayer } from '@radix-ui/react-dismissable-layer';
import { FocusScope } from '@radix-ui/react-focus-scope';
import * as PopperPrimitive from '@radix-ui/react-popper';
import { Portal } from '@radix-ui/react-portal';
import { Primitive } from '@radix-ui/react-primitive';

type Direction = 'ltr' | 'rtl';
type ScopedProps<P> = P & {
    __scopeSelect?: Scope;
};
declare const createSelectScope: _radix_ui_react_context.CreateScope;
interface SelectSharedProps {
    children?: React.ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?(open: boolean): void;
    dir?: Direction;
    name?: string;
    autoComplete?: string;
    disabled?: boolean;
    required?: boolean;
    form?: string;
}
type SelectProps = SelectSharedProps & {
    value?: string;
    defaultValue?: string;
    onValueChange?(value: string): void;
};
interface SelectProviderProps extends SelectSharedProps {
    value?: string;
    defaultValue?: string;
    onValueChange?(value: string): void;
}
declare function SelectProvider(props: ScopedProps<SelectProviderProps>): react_jsx_runtime.JSX.Element;
declare namespace SelectProvider {
    var displayName: string;
}
declare const Select: React.FC<SelectProps>;
type PrimitiveButtonProps = React.ComponentPropsWithoutRef<typeof Primitive.button>;
interface SelectTriggerProps extends PrimitiveButtonProps {
}
declare const SelectTrigger: React.ForwardRefExoticComponent<SelectTriggerProps & React.RefAttributes<HTMLButtonElement>>;
type PrimitiveSpanProps = React.ComponentPropsWithoutRef<typeof Primitive.span>;
interface SelectValueProps extends Omit<PrimitiveSpanProps, 'placeholder'> {
    placeholder?: React.ReactNode;
}
declare const SelectValue: React.ForwardRefExoticComponent<SelectValueProps & React.RefAttributes<HTMLSpanElement>>;
interface SelectIconProps extends PrimitiveSpanProps {
}
declare const SelectIcon: React.ForwardRefExoticComponent<SelectIconProps & React.RefAttributes<HTMLSpanElement>>;
type PortalProps = React.ComponentPropsWithoutRef<typeof Portal>;
interface SelectPortalProps {
    children?: React.ReactNode;
    /**
     * Specify a container element to portal the content into.
     */
    container?: PortalProps['container'];
    /**
     * Used to force mounting when more control is needed. Useful when controlling
     * animation with React animation libraries.
     */
    forceMount?: true;
}
declare const SelectPortal: React.FC<SelectPortalProps>;
interface SelectContentProps extends SelectContentImplProps {
    /**
     * Used to force mounting when more control is needed. Useful when
     * controlling animation with React animation libraries.
     */
    forceMount?: true;
}
declare const SelectContent: React.ForwardRefExoticComponent<SelectContentProps & React.RefAttributes<HTMLDivElement>>;
type DismissableLayerProps = React.ComponentPropsWithoutRef<typeof DismissableLayer>;
type FocusScopeProps = React.ComponentPropsWithoutRef<typeof FocusScope>;
type SelectPopperPrivateProps = {
    onPlaced?: PopperContentProps['onPlaced'];
};
interface SelectContentImplProps extends Omit<SelectPopperPositionProps, keyof SelectPopperPrivateProps>, Omit<SelectItemAlignedPositionProps, keyof SelectPopperPrivateProps> {
    /**
     * Event handler called when auto-focusing on close.
     * Can be prevented.
     */
    onCloseAutoFocus?: FocusScopeProps['onUnmountAutoFocus'];
    /**
     * Event handler called when the escape key is down.
     * Can be prevented.
     */
    onEscapeKeyDown?: DismissableLayerProps['onEscapeKeyDown'];
    /**
     * Event handler called when the a `pointerdown` event happens outside of the `DismissableLayer`.
     * Can be prevented.
     */
    onPointerDownOutside?: DismissableLayerProps['onPointerDownOutside'];
    position?: 'item-aligned' | 'popper';
}
interface SelectItemAlignedPositionProps extends PrimitiveDivProps, SelectPopperPrivateProps {
}
type PopperContentProps = React.ComponentPropsWithoutRef<typeof PopperPrimitive.Content>;
interface SelectPopperPositionProps extends PopperContentProps, SelectPopperPrivateProps {
}
type PrimitiveDivProps = React.ComponentPropsWithoutRef<typeof Primitive.div>;
interface SelectViewportProps extends PrimitiveDivProps {
    nonce?: string;
}
declare const SelectViewport: React.ForwardRefExoticComponent<SelectViewportProps & React.RefAttributes<HTMLDivElement>>;
interface SelectGroupProps extends PrimitiveDivProps {
}
declare const SelectGroup: React.ForwardRefExoticComponent<SelectGroupProps & React.RefAttributes<HTMLDivElement>>;
interface SelectLabelProps extends PrimitiveDivProps {
}
declare const SelectLabel: React.ForwardRefExoticComponent<SelectLabelProps & React.RefAttributes<HTMLDivElement>>;
interface SelectItemProps extends PrimitiveDivProps {
    value: string;
    disabled?: boolean;
    textValue?: string;
}
declare const SelectItem: React.ForwardRefExoticComponent<SelectItemProps & React.RefAttributes<HTMLDivElement>>;
interface SelectItemTextProps extends PrimitiveSpanProps {
}
declare const SelectItemText: React.ForwardRefExoticComponent<SelectItemTextProps & React.RefAttributes<HTMLSpanElement>>;
interface SelectItemIndicatorProps extends PrimitiveSpanProps {
}
declare const SelectItemIndicator: React.ForwardRefExoticComponent<SelectItemIndicatorProps & React.RefAttributes<HTMLSpanElement>>;
interface SelectScrollUpButtonProps extends Omit<SelectScrollButtonImplProps, 'onAutoScroll'> {
}
declare const SelectScrollUpButton: React.ForwardRefExoticComponent<SelectScrollUpButtonProps & React.RefAttributes<HTMLDivElement>>;
interface SelectScrollDownButtonProps extends Omit<SelectScrollButtonImplProps, 'onAutoScroll'> {
}
declare const SelectScrollDownButton: React.ForwardRefExoticComponent<SelectScrollDownButtonProps & React.RefAttributes<HTMLDivElement>>;
interface SelectScrollButtonImplProps extends PrimitiveDivProps {
    onAutoScroll(): void;
}
interface SelectSeparatorProps extends PrimitiveDivProps {
}
declare const SelectSeparator: React.ForwardRefExoticComponent<SelectSeparatorProps & React.RefAttributes<HTMLDivElement>>;
type PopperArrowProps = React.ComponentPropsWithoutRef<typeof PopperPrimitive.Arrow>;
interface SelectArrowProps extends PopperArrowProps {
}
declare const SelectArrow: React.ForwardRefExoticComponent<SelectArrowProps & React.RefAttributes<SVGSVGElement>>;
type PrimitiveSelectProps = React.ComponentPropsWithoutRef<typeof Primitive.select>;
interface SelectBubbleInputProps extends Omit<PrimitiveSelectProps, 'value'> {
}
declare const SelectBubbleInput: React.ForwardRefExoticComponent<SelectBubbleInputProps & React.RefAttributes<HTMLSelectElement>>;

export { SelectArrow as Arrow, SelectContent as Content, SelectGroup as Group, SelectIcon as Icon, SelectItem as Item, SelectItemIndicator as ItemIndicator, SelectItemText as ItemText, SelectLabel as Label, SelectPortal as Portal, Select as Root, SelectScrollDownButton as ScrollDownButton, SelectScrollUpButton as ScrollUpButton, Select, SelectArrow, type SelectArrowProps, SelectContent, type SelectContentProps, SelectGroup, type SelectGroupProps, SelectIcon, type SelectIconProps, SelectItem, SelectItemIndicator, type SelectItemIndicatorProps, type SelectItemProps, SelectItemText, type SelectItemTextProps, SelectLabel, type SelectLabelProps, SelectPortal, type SelectPortalProps, type SelectProps, SelectScrollDownButton, type SelectScrollDownButtonProps, SelectScrollUpButton, type SelectScrollUpButtonProps, SelectSeparator, type SelectSeparatorProps, type SelectSharedProps, SelectTrigger, type SelectTriggerProps, SelectValue, type SelectValueProps, SelectViewport, type SelectViewportProps, SelectSeparator as Separator, SelectTrigger as Trigger, SelectValue as Value, SelectViewport as Viewport, createSelectScope, SelectBubbleInput as unstable_BubbleInput, SelectProvider as unstable_Provider, SelectBubbleInput as unstable_SelectBubbleInput, type SelectBubbleInputProps as unstable_SelectBubbleInputProps, SelectProvider as unstable_SelectProvider, type SelectProviderProps as unstable_SelectProviderProps };

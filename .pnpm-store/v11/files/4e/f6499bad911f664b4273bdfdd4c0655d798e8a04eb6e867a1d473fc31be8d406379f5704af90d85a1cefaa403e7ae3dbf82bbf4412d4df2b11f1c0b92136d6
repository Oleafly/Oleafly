import * as react_jsx_runtime from 'react/jsx-runtime';
import * as _radix_ui_react_context from '@radix-ui/react-context';
import { Scope } from '@radix-ui/react-context';
import * as React from 'react';
import { Primitive } from '@radix-ui/react-primitive';
import * as RovingFocusGroup from '@radix-ui/react-roving-focus';

interface RadioProviderProps {
    checked?: boolean;
    required?: boolean;
    disabled?: boolean;
    name?: string;
    form?: string;
    value?: string | number | readonly string[];
    onCheck?(): void;
    children?: React.ReactNode;
}
interface RadioTriggerProps extends Omit<React.ComponentPropsWithoutRef<typeof Primitive.button>, keyof RadioProviderProps> {
    children?: React.ReactNode;
}
declare const RadioTrigger: React.ForwardRefExoticComponent<RadioTriggerProps & React.RefAttributes<HTMLButtonElement>>;
type PrimitiveButtonProps = React.ComponentPropsWithoutRef<typeof Primitive.button>;
interface RadioProps$1 extends Omit<PrimitiveButtonProps, 'checked'> {
    checked?: boolean;
    required?: boolean;
    onCheck?(): void;
}
declare const Radio: React.ForwardRefExoticComponent<RadioProps$1 & React.RefAttributes<HTMLButtonElement>>;
type PrimitiveSpanProps = React.ComponentPropsWithoutRef<typeof Primitive.span>;
interface RadioIndicatorProps$1 extends PrimitiveSpanProps {
    /**
     * Used to force mounting when more control is needed. Useful when
     * controlling animation with React animation libraries.
     */
    forceMount?: true;
}
declare const RadioIndicator: React.ForwardRefExoticComponent<RadioIndicatorProps$1 & React.RefAttributes<HTMLSpanElement>>;
type InputProps = React.ComponentPropsWithoutRef<typeof Primitive.input>;
interface RadioBubbleInputProps extends Omit<InputProps, 'checked'> {
}
declare const RadioBubbleInput: React.ForwardRefExoticComponent<RadioBubbleInputProps & React.RefAttributes<HTMLInputElement>>;

type ScopedProps<P> = P & {
    __scopeRadioGroup?: Scope;
};
declare const createRadioGroupScope: _radix_ui_react_context.CreateScope;
type RadioGroupContextValue = {
    name?: string;
    form?: string;
    required: boolean;
    disabled: boolean;
    value: string | null;
    onValueChange(value: string): void;
};
type RovingFocusGroupProps = React.ComponentPropsWithoutRef<typeof RovingFocusGroup.Root>;
type PrimitiveDivProps = React.ComponentPropsWithoutRef<typeof Primitive.div>;
interface RadioGroupProps extends PrimitiveDivProps {
    name?: RadioGroupContextValue['name'];
    form?: React.ComponentPropsWithoutRef<typeof Radio>['form'];
    required?: React.ComponentPropsWithoutRef<typeof Radio>['required'];
    disabled?: React.ComponentPropsWithoutRef<typeof Radio>['disabled'];
    dir?: RovingFocusGroupProps['dir'];
    orientation?: RovingFocusGroupProps['orientation'];
    loop?: RovingFocusGroupProps['loop'];
    defaultValue?: string;
    value?: string | null;
    onValueChange?: RadioGroupContextValue['onValueChange'];
}
declare const RadioGroup: React.ForwardRefExoticComponent<RadioGroupProps & React.RefAttributes<HTMLDivElement>>;
interface RadioGroupItemProviderProps {
    value: string;
    disabled?: boolean;
    children?: React.ReactNode;
}
declare function RadioGroupItemProvider(props: ScopedProps<RadioGroupItemProviderProps>): react_jsx_runtime.JSX.Element;
interface RadioGroupItemTriggerProps extends React.ComponentPropsWithoutRef<typeof RadioTrigger> {
}
declare const RadioGroupItemTrigger: React.ForwardRefExoticComponent<RadioGroupItemTriggerProps & React.RefAttributes<HTMLButtonElement>>;
type RadioProps = React.ComponentPropsWithoutRef<typeof Radio>;
interface RadioGroupItemProps extends Omit<RadioProps, 'onCheck' | 'name'> {
    value: string;
}
declare const RadioGroupItem: React.ForwardRefExoticComponent<RadioGroupItemProps & React.RefAttributes<HTMLButtonElement>>;
interface RadioGroupItemBubbleInputProps extends React.ComponentPropsWithoutRef<typeof RadioBubbleInput> {
}
declare const RadioGroupItemBubbleInput: React.ForwardRefExoticComponent<RadioGroupItemBubbleInputProps & React.RefAttributes<HTMLInputElement>>;
type RadioIndicatorProps = React.ComponentPropsWithoutRef<typeof RadioIndicator>;
interface RadioGroupIndicatorProps extends RadioIndicatorProps {
}
declare const RadioGroupIndicator: React.ForwardRefExoticComponent<RadioGroupIndicatorProps & React.RefAttributes<HTMLSpanElement>>;

export { RadioGroupIndicator as Indicator, RadioGroupItem as Item, RadioGroup, RadioGroupIndicator, type RadioGroupIndicatorProps, RadioGroupItem, type RadioGroupItemProps, type RadioGroupProps, RadioGroup as Root, createRadioGroupScope, RadioGroupItemBubbleInput as unstable_ItemBubbleInput, RadioGroupItemProvider as unstable_ItemProvider, RadioGroupItemTrigger as unstable_ItemTrigger, RadioGroupItemBubbleInput as unstable_RadioGroupItemBubbleInput, type RadioGroupItemBubbleInputProps as unstable_RadioGroupItemBubbleInputProps, RadioGroupItemProvider as unstable_RadioGroupItemProvider, type RadioGroupItemProviderProps as unstable_RadioGroupItemProviderProps, RadioGroupItemTrigger as unstable_RadioGroupItemTrigger, type RadioGroupItemTriggerProps as unstable_RadioGroupItemTriggerProps };

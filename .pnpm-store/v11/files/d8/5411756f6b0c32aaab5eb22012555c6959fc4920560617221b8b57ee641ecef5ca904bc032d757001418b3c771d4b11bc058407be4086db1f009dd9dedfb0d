import * as React from 'react';
import type { BaseOptionType, BaseSelectRef, DefaultOptionType, OptionProps, SelectProps as RcSelectProps, SearchConfig } from '@rc-component/select';
import { OptGroup, Option } from '@rc-component/select';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { SelectCommonPlacement } from '../_util/motion';
import type { InputStatus } from '../_util/statusUtils';
import type { Variant } from '../config-provider';
import type { SizeType } from '../config-provider/SizeContext';
type RawValue = string | number;
export type { BaseOptionType, DefaultOptionType, OptionProps, BaseSelectRef as RefSelectProps, SearchConfig, };
export interface LabeledValue {
    key?: string;
    value: RawValue;
    label: React.ReactNode;
}
export type SelectSemanticType = {
    classNames?: {
        root?: string;
        prefix?: string;
        suffix?: string;
        input?: string;
        placeholder?: string;
        content?: string;
        item?: string;
        itemContent?: string;
        itemRemove?: string;
        clear?: string;
        popup?: {
            root?: string;
            listItem?: string;
            list?: string;
        };
    };
    styles?: {
        root?: React.CSSProperties;
        prefix?: React.CSSProperties;
        suffix?: React.CSSProperties;
        input?: React.CSSProperties;
        placeholder?: React.CSSProperties;
        content?: React.CSSProperties;
        item?: React.CSSProperties;
        itemContent?: React.CSSProperties;
        itemRemove?: React.CSSProperties;
        clear?: React.CSSProperties;
        popup?: {
            root?: React.CSSProperties;
            listItem?: React.CSSProperties;
            list?: React.CSSProperties;
        };
    };
};
export type SelectSemanticAllType = GenerateSemantic<SelectSemanticType, SelectProps>;
export type SelectValue = RawValue | RawValue[] | LabeledValue | LabeledValue[] | undefined;
export interface InternalSelectProps<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType> extends Omit<RcSelectProps<ValueType, OptionType>, 'mode' | 'styles' | 'classNames'> {
    rootClassName?: string;
    prefix?: React.ReactNode;
    suffixIcon?: React.ReactNode;
    size?: SizeType;
    disabled?: boolean;
    mode?: 'multiple' | 'tags' | 'SECRET_COMBOBOX_MODE_DO_NOT_USE' | 'combobox';
    /** @deprecated Use `variant` instead. */
    bordered?: boolean;
    /**
     * @deprecated `showArrow` is deprecated which will be removed in next major version. It will be a
     *   default behavior, you can hide it by setting `suffixIcon` to null.
     */
    showArrow?: boolean;
    /**
     * @since 5.13.0
     * @default "outlined"
     */
    variant?: Variant;
    classNames?: SelectSemanticAllType['classNamesAndFn'];
    styles?: SelectSemanticAllType['stylesAndFn'];
    loadingIcon?: React.ReactNode;
    showSearch?: boolean | (SearchConfig<OptionType> & {
        searchIcon?: React.ReactNode;
    });
}
export interface SelectProps<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType> extends Omit<InternalSelectProps<ValueType, OptionType>, 'mode' | 'getInputElement' | 'getRawInputElement' | 'backfill' | 'placement' | 'dropdownClassName' | 'dropdownStyle'> {
    placement?: SelectCommonPlacement;
    mode?: 'multiple' | 'tags';
    status?: InputStatus;
    /** @deprecated Please use `classNames.popup.root` instead */
    popupClassName?: string;
    /** @deprecated Please use `classNames.popup.root` instead */
    dropdownClassName?: string;
    /** @deprecated Please use `styles.popup` instead */
    dropdownStyle?: React.CSSProperties;
    /** @deprecated Please use `popupRender` instead */
    dropdownRender?: SelectProps['popupRender'];
    /** @deprecated Please use `onOpenChange` instead */
    onDropdownVisibleChange?: SelectProps['onPopupVisibleChange'];
    /** @deprecated Please use `popupMatchSelectWidth` instead */
    dropdownMatchSelectWidth?: boolean | number;
    popupMatchSelectWidth?: boolean | number;
    onOpenChange?: (visible: boolean) => void;
}
declare const Select: (<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType>(props: React.PropsWithChildren<SelectProps<ValueType, OptionType>> & React.RefAttributes<BaseSelectRef>) => React.ReactElement) & {
    displayName?: string;
    SECRET_COMBOBOX_MODE_DO_NOT_USE: string;
    /** @deprecated Please use `options` instead. */
    Option: typeof Option;
    /** @deprecated Please use `options` instead. */
    OptGroup: typeof OptGroup;
    _InternalPanelDoNotUseOrYouWillBeFired: typeof PurePanel;
};
declare const PurePanel: (props: import("../_util/type").AnyObject) => React.JSX.Element;
export default Select;

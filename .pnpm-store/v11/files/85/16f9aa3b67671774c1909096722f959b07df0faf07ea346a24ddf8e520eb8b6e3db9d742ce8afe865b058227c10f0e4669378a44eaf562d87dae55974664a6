import * as React from 'react';
import type { BaseSelectRef } from '@rc-component/select';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { InputStatus } from '../_util/statusUtils';
import type { BaseOptionType, DefaultOptionType, InternalSelectProps, SearchConfig, SelectSemanticAllType } from '../select';
export type AutoCompleteSemanticType = {
    classNames?: {
        root?: string;
        prefix?: string;
        input?: string;
        placeholder?: string;
        content?: string;
        popup?: NonNullable<SelectSemanticAllType['classNames']>['popup'];
    };
    styles?: {
        root?: React.CSSProperties;
        prefix?: React.CSSProperties;
        input?: React.CSSProperties;
        placeholder?: React.CSSProperties;
        content?: React.CSSProperties;
        popup?: NonNullable<SelectSemanticAllType['styles']>['popup'];
    };
};
export interface DataSourceItemObject {
    value: string;
    text: string;
}
export type DataSourceItemType = DataSourceItemObject | React.ReactNode;
export type AutoCompleteSemanticAllType = GenerateSemantic<AutoCompleteSemanticType, AutoCompleteProps>;
export interface AutoCompleteProps<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType> extends Omit<InternalSelectProps<ValueType, OptionType>, 'loading' | 'mode' | 'optionLabelProp' | 'labelInValue' | 'styles' | 'classNames' | 'showSearch' | 'optionFilterProp' | 'filterSort'> {
    /** @deprecated Please use `options` instead */
    dataSource?: DataSourceItemType[];
    status?: InputStatus;
    /** @deprecated Please use `classNames.popup.root` instead */
    popupClassName?: string;
    /** @deprecated Please use `classNames.popup.root` instead */
    dropdownClassName?: string;
    /** @deprecated Please use `popupMatchSelectWidth` instead */
    dropdownMatchSelectWidth?: boolean | number;
    popupMatchSelectWidth?: boolean | number;
    classNames?: AutoCompleteSemanticAllType['classNamesAndFn'];
    styles?: AutoCompleteSemanticAllType['stylesAndFn'];
    /** @deprecated Please use `popupRender` instead */
    dropdownRender?: (menu: React.ReactElement) => React.ReactElement;
    popupRender?: (menu: React.ReactElement) => React.ReactElement;
    /** @deprecated Please use `styles.popup.root` instead */
    dropdownStyle?: React.CSSProperties;
    /** @deprecated Please use `onOpenChange` instead */
    onDropdownVisibleChange?: (visible: boolean) => void;
    onOpenChange?: (visible: boolean) => void;
    showSearch?: boolean | Pick<SearchConfig<OptionType> & {
        searchIcon?: React.ReactNode;
    }, 'filterOption' | 'onSearch' | 'searchIcon'>;
}
declare const RefAutoComplete: (<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType>(props: React.PropsWithChildren<AutoCompleteProps<ValueType, OptionType>> & React.RefAttributes<BaseSelectRef>) => React.ReactElement) & {
    displayName?: string;
};
export default RefAutoComplete;

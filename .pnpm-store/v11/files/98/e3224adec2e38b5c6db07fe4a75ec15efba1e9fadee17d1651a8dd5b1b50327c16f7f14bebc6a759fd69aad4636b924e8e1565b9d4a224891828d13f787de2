import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { ButtonSemanticType } from '../button/Button';
import type { InputProps, InputRef } from './Input';
export type InputSearchSemanticType = {
    classNames?: {
        root?: string;
        input?: string;
        prefix?: string;
        suffix?: string;
        clear?: string;
        count?: string;
        button?: ButtonSemanticType['classNames'];
    };
    styles?: {
        root?: React.CSSProperties;
        input?: React.CSSProperties;
        prefix?: React.CSSProperties;
        suffix?: React.CSSProperties;
        clear?: React.CSSProperties;
        count?: React.CSSProperties;
        button?: ButtonSemanticType['styles'];
    };
};
export type InputSearchSemanticAllType = GenerateSemantic<InputSearchSemanticType, SearchProps>;
export interface SearchProps extends InputProps {
    inputPrefixCls?: string;
    onSearch?: (value: string, event?: React.ChangeEvent<HTMLInputElement> | React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLInputElement>, info?: {
        source?: 'clear' | 'input';
    }) => void;
    searchIcon?: React.ReactNode;
    enterButton?: React.ReactNode;
    loading?: boolean;
    onPressEnter?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    classNames?: InputSearchSemanticAllType['classNamesAndFn'];
    styles?: InputSearchSemanticAllType['stylesAndFn'];
}
declare const Search: React.ForwardRefExoticComponent<SearchProps & React.RefAttributes<InputRef>>;
export default Search;

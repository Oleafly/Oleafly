import React from 'react';
import type { InputRef, InputProps as RcInputProps } from '@rc-component/input';
import { triggerFocus } from '@rc-component/util';
import type { InputFocusOptions } from '@rc-component/util';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { InputStatus } from '../_util/statusUtils';
import type { Variant } from '../config-provider';
import type { SizeType } from '../config-provider/SizeContext';
export type { InputFocusOptions };
export type { InputRef };
export { triggerFocus };
export type InputSemanticType = {
    classNames?: {
        root?: string;
        prefix?: string;
        suffix?: string;
        clear?: string;
        input?: string;
        count?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        prefix?: React.CSSProperties;
        suffix?: React.CSSProperties;
        clear?: React.CSSProperties;
        input?: React.CSSProperties;
        count?: React.CSSProperties;
    };
};
export type InputSemanticAllType = GenerateSemantic<InputSemanticType, InputProps>;
export interface InputProps extends Omit<RcInputProps, 'wrapperClassName' | 'groupClassName' | 'inputClassName' | 'affixWrapperClassName' | 'classes' | 'classNames' | 'styles'> {
    rootClassName?: string;
    size?: SizeType;
    disabled?: boolean;
    status?: InputStatus;
    /**
     * @deprecated Use `Space.Compact` instead.
     *
     * @example
     * ```tsx
     * import { Space, Input } from 'antd';
     *
     * <Space.Compact>
     *   {addon}
     *   <Input defaultValue="name" />
     * </Space.Compact>
     * ```
     */
    addonBefore?: React.ReactNode;
    /**
     * @deprecated Use `Space.Compact` instead.
     *
     * @example
     * ```tsx
     * import { Space, Input } from 'antd';
     *
     * <Space.Compact>
     *   <Input defaultValue="name" />
     *   {addon}
     * </Space.Compact>
     * ```
     */
    addonAfter?: React.ReactNode;
    /** @deprecated Use `variant="borderless"` instead. */
    bordered?: boolean;
    /**
     * @since 5.13.0
     * @default "outlined"
     */
    variant?: Variant;
    classNames?: InputSemanticAllType['classNamesAndFn'];
    styles?: InputSemanticAllType['stylesAndFn'];
    [key: `data-${string}`]: string | undefined;
}
declare const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<InputRef>>;
export default Input;

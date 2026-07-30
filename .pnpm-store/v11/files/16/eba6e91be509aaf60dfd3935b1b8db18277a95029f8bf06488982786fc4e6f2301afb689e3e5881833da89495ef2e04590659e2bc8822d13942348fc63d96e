import * as React from 'react';
import type { TextAreaProps as RcTextAreaProps, TextAreaRef as RcTextAreaRef } from '@rc-component/input';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { InputStatus } from '../_util/statusUtils';
import type { Variant } from '../config-provider';
import type { SizeType } from '../config-provider/SizeContext';
import type { InputFocusOptions } from './Input';
export type TextAreaSemanticType = {
    classNames?: {
        root?: string;
        textarea?: string;
        clear?: string;
        count?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        textarea?: React.CSSProperties;
        clear?: React.CSSProperties;
        count?: React.CSSProperties;
    };
};
export type TextAreaSemanticAllType = GenerateSemantic<TextAreaSemanticType, TextAreaProps>;
export interface TextAreaProps extends Omit<RcTextAreaProps, 'suffix' | 'classNames' | 'styles'> {
    /** @deprecated Use `variant` instead */
    bordered?: boolean;
    size?: SizeType;
    status?: InputStatus;
    rootClassName?: string;
    /**
     * @since 5.13.0
     * @default "outlined"
     */
    variant?: Variant;
    classNames?: TextAreaSemanticAllType['classNamesAndFn'];
    styles?: TextAreaSemanticAllType['stylesAndFn'];
}
export interface TextAreaRef {
    focus: (options?: InputFocusOptions) => void;
    blur: () => void;
    resizableTextArea?: RcTextAreaRef['resizableTextArea'];
    nativeElement: HTMLElement | null;
}
declare const TextArea: React.ForwardRefExoticComponent<TextAreaProps & React.RefAttributes<TextAreaRef>>;
export default TextArea;

import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { SizeType } from '../config-provider/SizeContext';
export type SpinIndicator = React.ReactElement<HTMLElement>;
export type SpinSemanticType = {
    classNames?: {
        root?: string;
        section?: string;
        indicator?: string;
        description?: string;
        container?: string;
        /** @deprecated Please use `description` instead */
        tip?: string;
        /** @deprecated Please use `root` instead */
        mask?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        section?: React.CSSProperties;
        indicator?: React.CSSProperties;
        description?: React.CSSProperties;
        container?: React.CSSProperties;
        /** @deprecated Please use `description` instead */
        tip?: React.CSSProperties;
        /** @deprecated Please use `root` instead */
        mask?: React.CSSProperties;
    };
};
export type SpinSemanticAllType = GenerateSemantic<SpinSemanticType, SpinProps>;
export interface SpinProps {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    /** Whether Spin is spinning */
    spinning?: boolean;
    style?: React.CSSProperties;
    /**
     * Note: `default` is deprecated and will be removed in v7, please use `medium` instead.
     */
    size?: SizeType | 'default';
    /** Customize description content when Spin has children */
    /** @deprecated Please use `description` instead */
    tip?: React.ReactNode;
    description?: React.ReactNode;
    /** Specifies a delay in milliseconds for loading state (prevent flush) */
    delay?: number;
    /** The className of wrapper when Spin has children */
    /** @deprecated Please use `classNames.root` instead */
    wrapperClassName?: string;
    /** React node of the spinning indicator */
    indicator?: SpinIndicator;
    children?: React.ReactNode;
    /** Display a backdrop with the `Spin` component */
    fullscreen?: boolean;
    percent?: number | 'auto';
    classNames?: SpinSemanticAllType['classNamesAndFn'];
    styles?: SpinSemanticAllType['stylesAndFn'];
}
export type SpinType = React.FC<SpinProps> & {
    setDefaultIndicator: (indicator: React.ReactNode) => void;
};
declare const Spin: SpinType;
export default Spin;

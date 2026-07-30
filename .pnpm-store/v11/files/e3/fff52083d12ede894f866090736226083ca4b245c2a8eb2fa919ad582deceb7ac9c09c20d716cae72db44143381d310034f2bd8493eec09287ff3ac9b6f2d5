import * as React from 'react';
import type { PresetColorType } from '../_util/colors';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { LiteralUnion } from '../_util/type';
type RibbonPlacement = 'start' | 'end';
export type RibbonSemanticType = {
    classNames?: {
        root?: string;
        content?: string;
        indicator?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        content?: React.CSSProperties;
        indicator?: React.CSSProperties;
    };
};
export type RibbonSemanticAllType = GenerateSemantic<RibbonSemanticType, RibbonProps>;
export interface RibbonProps {
    className?: string;
    prefixCls?: string;
    style?: React.CSSProperties;
    text?: React.ReactNode;
    color?: LiteralUnion<PresetColorType>;
    children?: React.ReactNode;
    placement?: RibbonPlacement;
    rootClassName?: string;
    classNames?: RibbonSemanticAllType['classNamesAndFn'];
    styles?: RibbonSemanticAllType['stylesAndFn'];
}
declare const Ribbon: React.FC<RibbonProps>;
export default Ribbon;

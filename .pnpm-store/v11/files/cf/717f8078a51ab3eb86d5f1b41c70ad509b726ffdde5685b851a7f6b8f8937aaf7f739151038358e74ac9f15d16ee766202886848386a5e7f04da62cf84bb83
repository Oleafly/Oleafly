import * as React from 'react';
import type { Orientation } from '../_util/hooks';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
import type { SizeType } from '../config-provider/SizeContext';
export type TitlePlacement = 'left' | 'right' | 'center' | 'start' | 'end';
export type DividerSemanticType = {
    classNames?: {
        root?: string;
        rail?: string;
        content?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        rail?: React.CSSProperties;
        content?: React.CSSProperties;
    };
};
export type CardSemanticAllType = GenerateSemantic<DividerSemanticType, DividerProps>;
export interface DividerProps {
    prefixCls?: string;
    /**  @deprecated please use `orientation`*/
    type?: Orientation;
    orientation?: Orientation;
    vertical?: boolean;
    titlePlacement?: TitlePlacement;
    /** @deprecated please use `styles.content.margin` */
    orientationMargin?: string | number;
    className?: string;
    rootClassName?: string;
    children?: React.ReactNode;
    dashed?: boolean;
    /**
     * @since 5.20.0
     * @default solid
     */
    variant?: 'dashed' | 'dotted' | 'solid';
    style?: React.CSSProperties;
    size?: SizeType;
    plain?: boolean;
    classNames?: CardSemanticAllType['classNamesAndFn'];
    styles?: CardSemanticAllType['stylesAndFn'];
}
declare const Divider: React.FC<DividerProps>;
export default Divider;

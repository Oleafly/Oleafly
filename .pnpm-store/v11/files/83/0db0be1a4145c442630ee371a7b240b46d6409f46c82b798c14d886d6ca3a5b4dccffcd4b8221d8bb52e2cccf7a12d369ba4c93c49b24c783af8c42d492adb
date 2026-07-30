import * as React from 'react';
import type { GenerateSemantic } from '../_util/hooks/useMergeSemantic/semanticType';
export type CardMetaSemanticType = {
    classNames?: {
        root?: string;
        section?: string;
        avatar?: string;
        title?: string;
        description?: string;
    };
    styles?: {
        root?: React.CSSProperties;
        section?: React.CSSProperties;
        avatar?: React.CSSProperties;
        title?: React.CSSProperties;
        description?: React.CSSProperties;
    };
};
export type CardMetaSemanticAllType = GenerateSemantic<CardMetaSemanticType, CardMetaProps>;
export interface CardMetaProps {
    prefixCls?: string;
    style?: React.CSSProperties;
    className?: string;
    avatar?: React.ReactNode;
    title?: React.ReactNode;
    description?: React.ReactNode;
    classNames?: CardMetaSemanticAllType['classNamesAndFn'];
    styles?: CardMetaSemanticAllType['stylesAndFn'];
}
declare const CardMeta: React.FC<CardMetaProps>;
export default CardMeta;

import * as React from 'react';
import type { AnyObject, ValidChar } from '../../type';
import type { RemoveClassNamesString } from './semanticType';
export type SemanticSchema = {
    _default?: string;
} & {
    [key: `${ValidChar}${string}`]: SemanticSchema;
};
export declare const mergeClassNames: <Name extends string, SemanticClassNames extends Partial<Record<Name, any>>>(schema?: SemanticSchema, ...classNames: (SemanticClassNames | undefined)[]) => SemanticClassNames;
export declare const mergeStyles: <StylesType extends AnyObject>(...styles: (Partial<StylesType> | undefined)[]) => Record<PropertyKey, React.CSSProperties>;
export declare const useSemanticRootStyle: (style?: React.CSSProperties) => {
    root: React.CSSProperties;
} | undefined;
export declare const resolveStyleOrClass: <T = any>(value: T | ((config: any) => T), info: {
    props: any;
}) => T;
type MaybeFn<T, P> = T | ((info: {
    props: P;
}) => T) | undefined;
/**
 * @desc Merge classNames and styles from multiple sources. When `schema` is provided, it **must** provide the nest object structure.
 * @descZH 合并来自多个来源的 classNames 和 styles，当提供了 `schema` 时，必须提供嵌套的对象结构。
 */
export declare const useMergeSemantic: <ClassNamesType extends AnyObject | undefined = AnyObject, StylesType extends AnyObject | undefined = AnyObject, Props = any>(classNamesList: MaybeFn<ClassNamesType, Props>[], stylesList: MaybeFn<StylesType, Props>[], info: {
    props: Props;
}, schema?: SemanticSchema) => [Required<RemoveClassNamesString<NonNullable<ClassNamesType>>>, Required<NonNullable<StylesType>>];
export {};

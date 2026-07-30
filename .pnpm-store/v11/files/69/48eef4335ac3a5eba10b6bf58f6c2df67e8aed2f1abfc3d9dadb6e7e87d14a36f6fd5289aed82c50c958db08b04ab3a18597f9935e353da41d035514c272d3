import * as Ast from '@unified-latex/unified-latex-types';
import { Plugin as Plugin_2 } from 'unified';

/**
 * Returns whether the array has whitespace at the start/end. Comments with `leadingWhitespace === true`
 * are counted as whitespace. Other comments are ignored.
 */
export declare function hasWhitespaceEquivalent(nodes: Ast.Node[]): {
    start: boolean;
    end: boolean;
};

declare type PluginOptions = void;

declare type PluginOptions_2 = void;

/**
 * Trims whitespace and parbreaks from the start and end
 * of an array. The number of trimmed nodes is returned.
 * Special care is taken to preserve comments, though any whitespace
 * before the first comment(s) or after the last comment(s) is trimmed.
 */
export declare function trim(nodes: Ast.Node[]): {
    trimmedStart: number;
    trimmedEnd: number;
};

/**
 * Trim whitespace and parbreaks from the right of an array.
 */
export declare function trimEnd(nodes: Ast.Node[]): {
    trimmedEnd: number;
};

/**
 * Trim whitespace and parbreaks from the left of an array.
 */
export declare function trimStart(nodes: Ast.Node[]): {
    trimmedStart: number;
};

/**
 * Unified plugin to trim the whitespace from the start/end of any environments, including
 * math environments.
 */
export declare const unifiedLatexTrimEnvironmentContents: Plugin_2<PluginOptions[], Ast.Root, Ast.Root>;

/**
 * Unified plugin to trim the whitespace from the start/end of the root element.
 */
export declare const unifiedLatexTrimRoot: Plugin_2<PluginOptions_2[], Ast.Root, Ast.Root>;

export { }

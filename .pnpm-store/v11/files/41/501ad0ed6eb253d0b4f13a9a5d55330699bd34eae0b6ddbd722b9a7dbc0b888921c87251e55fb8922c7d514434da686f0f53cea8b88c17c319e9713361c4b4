import * as Ast from '@unified-latex/unified-latex-types';

export declare const AlignEnvironmentPegParser: PegParser;

export declare const ArgSpecPegParser: PegParser;

/**
 * Pegjs operates on strings. However, strings and arrays are very similar!
 * This function adds `charAt`, `charCodeAt`, and `substring` methods to
 * `array` so that `array` can then be fed to a Pegjs generated parser.
 *
 * @param {[object]} array
 * @returns {[object]}
 */
export declare function decorateArrayForPegjs(array: any[]): StringlikeArray;

export declare const GluePegParser: PegParser;

export declare const LatexPegParser: PegParser;

export declare const LigaturesPegParser: PegParser;

export declare const MacroSubstitutionPegParser: PegParser;

declare type PegParser = {
    parse: (input: string | unknown[], options?: unknown) => any;
    SyntaxError: (message: string, expected: string, found: unknown, location: unknown) => unknown;
};

export declare const PgfkeysPegParser: PegParser;

/**
 * Splits all multi-character strings into strings that are all single characters.
 */
export declare function splitStringsIntoSingleChars(nodes: Ast.Node[]): Ast.Node[];

declare type StringlikeArray = any[] & string;

export declare const SystemePegParser: PegParser;

export declare const TabularPegParser: PegParser;

export declare const TikzPegParser: PegParser;

export declare const XColorPegParser: PegParser;

export { }

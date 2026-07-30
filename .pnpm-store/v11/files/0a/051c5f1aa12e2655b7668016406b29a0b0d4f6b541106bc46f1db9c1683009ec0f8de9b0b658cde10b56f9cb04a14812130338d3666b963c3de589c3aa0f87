import * as Ast from '@unified-latex/unified-latex-types';

export declare const linebreak: unique symbol;

declare type Printable = Ast.Node | Ast.Argument | string;

/**
 * Renders the AST to a string without any pretty printing.
 *
 * @param {*} node
 * @param {*} options - Setting `asArray` to `true` will return an array of strings and the symbol `linebreak`, so that printing can be customized.
 */
export declare function printRaw(node: Printable | Printable[], options?: {
    asArray: false;
}): string;

export declare function printRaw(node: Printable | Printable[], options: {
    asArray: true;
}): PrintToken[];

declare type PrintToken = string | typeof linebreak;

export { }

import * as Ast from '@unified-latex/unified-latex-types';

/**
 * Removes any `_renderInfo` and `position` tags present in the AST. This
 * operation is _destructive_.
 */
export declare function trimRenderInfo<T extends Ast.Ast>(ast: T): T;

/**
 * Updates the `._renderInfo` property on a node to include
 * whatever has been supplied to `renderInfo`. If `renderInfo`
 * is null, no update is performed.
 *
 * *This operation mutates `node`*
 */
export declare function updateRenderInfo(node: Ast.Node | Ast.Argument, renderInfo: object | null | undefined): Ast.Node | Ast.Argument;

export { }

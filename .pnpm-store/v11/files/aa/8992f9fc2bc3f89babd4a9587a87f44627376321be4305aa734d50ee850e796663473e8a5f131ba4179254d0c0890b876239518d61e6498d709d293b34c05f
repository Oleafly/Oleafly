import * as Ast from '@unified-latex/unified-latex-types';
import { default as Trie } from 'trie-prefix-tree';

/**
 * Efficiently search for a large number of strings using a prefix-tree.
 * The longest match is returned.
 *
 * @param options.startIndex the index to start scanning at. Defaults to 0.
 * @param options.matchSubstrings whether to allow matching only part of a substring.
 * @param options.assumeOneCharStrings assume that all strings are one character long (for example, like they are in math mode)
 */
export declare function prefixMatch(nodes: Ast.Node[], prefixes: string | string[] | ReturnType<typeof Trie>, options?: {
    startIndex?: number;
    matchSubstrings?: boolean;
    assumeOneCharStrings?: boolean;
}): {
    match: string;
    endNodeIndex: number;
    endNodePartialMatch: string | null;
} | null;

/**
 * Scan `nodes` looking for the first occurrence of `token`.
 * If `options.onlySkipWhitespaceAndComments==true`, then the scan
 * will only skip whitespace/comment nodes.
 */
export declare function scan(nodes: (Ast.Node | Ast.Argument)[], token: string | Ast.Node | Ast.Argument, options?: {
    /**
     * Index to start scanning.
     */
    startIndex?: number;
    /**
     * If `true`, whitespace and comments will be skilled but any other
     * node that doesn't match `token` will cause the scan to terminate.
     */
    onlySkipWhitespaceAndComments?: boolean;
    /**
     * If `true`, will look inside `Ast.String` nodes to see if the string contents
     * contain `token`.
     */
    allowSubstringMatches?: boolean;
}): number | null;

export { Trie }

export { }

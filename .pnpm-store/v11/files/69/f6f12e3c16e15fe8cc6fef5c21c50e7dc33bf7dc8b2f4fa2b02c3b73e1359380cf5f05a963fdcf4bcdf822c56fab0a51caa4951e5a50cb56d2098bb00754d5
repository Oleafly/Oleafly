import { Node } from '@tiptap/core';

/** @jsxImportSource @tiptap/core */

interface BlockquoteOptions {
    /**
     * HTML attributes to add to the blockquote element
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        blockQuote: {
            /**
             * Set a blockquote node
             */
            setBlockquote: () => ReturnType;
            /**
             * Toggle a blockquote node
             */
            toggleBlockquote: () => ReturnType;
            /**
             * Unset a blockquote node
             */
            unsetBlockquote: () => ReturnType;
        };
    }
}
/**
 * Matches a blockquote to a `>` as input.
 */
declare const inputRegex: RegExp;
/**
 * This extension allows you to create blockquotes.
 * @see https://tiptap.dev/api/nodes/blockquote
 */
declare const Blockquote: Node<BlockquoteOptions, any>;

export { Blockquote, type BlockquoteOptions, Blockquote as default, inputRegex };

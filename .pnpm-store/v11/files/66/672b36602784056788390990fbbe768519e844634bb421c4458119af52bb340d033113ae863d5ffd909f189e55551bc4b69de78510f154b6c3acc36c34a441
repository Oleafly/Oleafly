import { Extension } from '@tiptap/core';

declare const skipTrailingNodeMeta = "skipTrailingNode";
/**
 * Extension based on:
 * - https://github.com/ueberdosis/tiptap/blob/v1/packages/tiptap-extensions/src/extensions/TrailingNode.js
 * - https://github.com/remirror/remirror/blob/e0f1bec4a1e8073ce8f5500d62193e52321155b9/packages/prosemirror-trailing-node/src/trailing-node-plugin.ts
 */
interface TrailingNodeOptions {
    /**
     * The node type that should be inserted at the end of the document.
     * @note the node will always be added to the `notAfter` lists to
     * prevent an infinite loop.
     * @default undefined
     */
    node?: string;
    /**
     * The node types after which the trailing node should not be inserted.
     * @default ['paragraph']
     */
    notAfter?: string | string[];
}
/**
 * This extension allows you to add an extra node at the end of the document.
 * @see https://www.tiptap.dev/api/extensions/trailing-node
 */
declare const TrailingNode: Extension<TrailingNodeOptions, any>;

export { TrailingNode, type TrailingNodeOptions, skipTrailingNodeMeta };

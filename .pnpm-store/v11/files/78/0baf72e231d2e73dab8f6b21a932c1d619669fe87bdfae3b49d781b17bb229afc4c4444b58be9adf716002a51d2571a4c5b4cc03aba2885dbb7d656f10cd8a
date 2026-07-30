import { Node } from '@tiptap/core';

interface BulletListOptions {
    /**
     * The node name for the list items
     * @default 'listItem'
     * @example 'paragraph'
     */
    itemTypeName: string;
    /**
     * HTML attributes to add to the bullet list element
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
    /**
     * Keep the marks when splitting the list
     * @default false
     * @example true
     */
    keepMarks: boolean;
    /**
     * Keep the attributes when splitting the list
     * @default false
     * @example true
     */
    keepAttributes: boolean;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        bulletList: {
            /**
             * Toggle a bullet list
             */
            toggleBulletList: () => ReturnType;
        };
    }
}
/**
 * Matches a bullet list to a dash or asterisk.
 */
declare const bulletListInputRegex: RegExp;
/**
 * This extension allows you to create bullet lists.
 * This requires the ListItem extension
 * @see https://tiptap.dev/api/nodes/bullet-list
 * @see https://tiptap.dev/api/nodes/list-item.
 */
declare const BulletList: Node<BulletListOptions, any>;

export { BulletList, type BulletListOptions, bulletListInputRegex };

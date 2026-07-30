import { Extension } from '@tiptap/core';

interface FocusOptions {
    /**
     * The class name that should be added to the focused node.
     * @default 'has-focus'
     * @example 'is-focused'
     */
    className: string;
    /**
     * The mode by which the focused node is determined.
     * - All: All nodes are marked as focused.
     * - Deepest: Only the deepest node is marked as focused.
     * - Shallowest: Only the shallowest node is marked as focused.
     *
     * @default 'all'
     * @example 'deepest'
     * @example 'shallowest'
     */
    mode: 'all' | 'deepest' | 'shallowest';
}
/**
 * This extension allows you to add a class to the focused node.
 * @see https://www.tiptap.dev/api/extensions/focus
 */
declare const Focus: Extension<FocusOptions, any>;

export { Focus, type FocusOptions };

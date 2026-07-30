import { Extension, ParentConfig, Editor } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { PluginKey } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';

interface CharacterCountOptions {
    /**
     * The maximum number of characters that should be allowed. Defaults to `0`.
     * @default null
     * @example 180
     */
    limit: number | null | undefined;
    /**
     * The mode by which the size is calculated. If set to `textSize`, the textContent of the document is used.
     * If set to `nodeSize`, the nodeSize of the document is used.
     * @default 'textSize'
     * @example 'textSize'
     */
    mode: 'textSize' | 'nodeSize';
    /**
     * Sets whether the content will be automatically trimmed when programatically setting content over the limit.
     * If set to false, the user will be able to trim the text manually.
     * @default true
     * @example false
     */
    autoTrim?: boolean;
    /**
     * The text counter function to use. Defaults to a simple character count.
     * @default (text) => text.length
     * @example (text) => [...new Intl.Segmenter().segment(text)].length
     */
    textCounter: (text: string) => number;
    /**
     * The word counter function to use. Defaults to a simple word count.
     * @default (text) => text.split(' ').filter(word => word !== '').length
     * @example (text) => text.split(/\s+/).filter(word => word !== '').length
     */
    wordCounter: (text: string) => number;
}
interface CharacterCountStorage {
    /**
     * Get the number of characters for the current document.
     * @param options The options for the character count. (optional)
     * @param options.node The node to get the characters from. Defaults to the current document.
     * @param options.mode The mode by which the size is calculated. If set to `textSize`, the textContent of the document is used.
     */
    characters: (options?: {
        node?: Node;
        mode?: 'textSize' | 'nodeSize';
    }) => number;
    /**
     * Get the number of words for the current document.
     * @param options The options for the character count. (optional)
     * @param options.node The node to get the words from. Defaults to the current document.
     */
    words: (options?: {
        node?: Node;
    }) => number;
}
declare module '@tiptap/core' {
    interface Storage {
        characterCount: CharacterCountStorage;
    }
}
/**
 * This extension allows you to count the characters and words of your document.
 * @see https://tiptap.dev/api/extensions/character-count
 */
declare const CharacterCount: Extension<CharacterCountOptions, CharacterCountStorage>;

interface DropcursorOptions {
    /**
     * The color of the drop cursor. Use `false` to apply no color and rely only on class.
     * @default 'currentColor'
     * @example 'red'
     */
    color?: string | false;
    /**
     * The width of the drop cursor
     * @default 1
     * @example 2
     */
    width: number | undefined;
    /**
     * The class of the drop cursor
     * @default undefined
     * @example 'drop-cursor'
     */
    class: string | undefined;
}
/**
 * This extension allows you to add a drop cursor to your editor.
 * A drop cursor is a line that appears when you drag and drop content
 * in-between nodes.
 * @see https://tiptap.dev/api/extensions/dropcursor
 */
declare const Dropcursor: Extension<DropcursorOptions, any>;

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

declare module '@tiptap/core' {
    interface NodeConfig<Options, Storage> {
        /**
         * A function to determine whether the gap cursor is allowed at the current position. Must return `true` or `false`.
         * @default null
         */
        allowGapCursor?: boolean | null | ((this: {
            name: string;
            options: Options;
            storage: Storage;
            parent: ParentConfig<NodeConfig<Options>>['allowGapCursor'];
        }) => boolean | null);
    }
}
/**
 * This extension allows you to add a gap cursor to your editor.
 * A gap cursor is a cursor that appears when you click on a place
 * where no content is present, for example inbetween nodes.
 * @see https://tiptap.dev/api/extensions/gapcursor
 */
declare const Gapcursor: Extension<any, any>;

/** The default data attribute label */
declare const DEFAULT_DATA_ATTRIBUTE = "placeholder";
/** The plugin key used to store and read the placeholder decoration set */
declare const PLUGIN_KEY: PluginKey<DecorationSet>;

interface PlaceholderOptions {
    /**
     * **The class name for the empty editor**
     * @default 'is-editor-empty'
     */
    emptyEditorClass: string;
    /**
     * **The class name for empty nodes**
     *
     * You can use a function to return a dynamic class name or a string.
     * @default 'is-empty'
     */
    emptyNodeClass: ((EmptyNodeClassProps: {
        editor: Editor;
        node: Node;
        pos: number;
        hasAnchor: boolean;
    }) => string) | string;
    /**
     * **The data-attribute used for the placeholder label**
     * Will be prepended with `data-` and converted to kebab-case and cleaned of special characters.
     * @default 'placeholder'
     */
    dataAttribute: string;
    /**
     * **The placeholder content**
     *
     * You can use a function to return a dynamic placeholder or a string.
     * @default 'Write something …'
     */
    placeholder: ((PlaceholderProps: {
        editor: Editor;
        node: Node;
        pos: number;
        hasAnchor: boolean;
    }) => string) | string;
    /**
     * **Checks if the placeholder should be only shown when the editor is editable.**
     *
     * If true, the placeholder will only be shown when the editor is editable.
     * If false, the placeholder will always be shown.
     * @default true
     */
    showOnlyWhenEditable: boolean;
    /**
     * **Checks if the placeholder should be only shown when the current node is empty.**
     *
     * If true, the placeholder will only be shown when the current node is empty.
     * If false, the placeholder will be shown when any node is empty.
     * @default true
     */
    showOnlyCurrent: boolean;
    /**
     * **Controls if the placeholder should be shown for all descendants.**
     *
     * If true, the placeholder will be shown for all descendants.
     * If false, the placeholder will only be shown for the current node.
     * @default false
     */
    includeChildren: boolean;
}

/**
 * This extension allows you to add a placeholder to your editor.
 * A placeholder is a text that appears when the editor or a node is empty.
 * @see https://www.tiptap.dev/api/extensions/placeholder
 */
declare const Placeholder: Extension<PlaceholderOptions, any>;

/**
 * Prepares the placeholder attribute by ensuring it is properly formatted.
 * @param attr - The placeholder attribute string.
 * @returns The prepared placeholder attribute string.
 */
declare function preparePlaceholderAttribute(attr: string): string;

type SelectionOptions = {
    /**
     * The class name that should be added to the selected text.
     * @default 'selection'
     * @example 'is-selected'
     */
    className: string;
};
/**
 * This extension allows you to add a class to the selected text when the editor is blurred.
 * It clears the native browser selection on blur (so `::selection` styles do not overlap the
 * decoration) and restores it when the editor is focused again.
 * @see https://www.tiptap.dev/api/extensions/selection
 */
declare const Selection: Extension<SelectionOptions, any>;

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

interface UndoRedoOptions {
    /**
     * The amount of history events that are collected before the oldest events are discarded.
     * @default 100
     * @example 50
     */
    depth: number;
    /**
     * The delay (in milliseconds) between changes after which a new group should be started.
     * @default 500
     * @example 1000
     */
    newGroupDelay: number;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        undoRedo: {
            /**
             * Undo recent changes
             * @example editor.commands.undo()
             */
            undo: () => ReturnType;
            /**
             * Reapply reverted changes
             * @example editor.commands.redo()
             */
            redo: () => ReturnType;
        };
    }
}
/**
 * This extension allows you to undo and redo recent changes.
 * @see https://www.tiptap.dev/api/extensions/undo-redo
 *
 * **Important**: If the `@tiptap/extension-collaboration` package is used, make sure to remove
 * the `undo-redo` extension, as it is not compatible with the `collaboration` extension.
 *
 * `@tiptap/extension-collaboration` uses its own history implementation.
 */
declare const UndoRedo: Extension<UndoRedoOptions, any>;

export { CharacterCount, type CharacterCountOptions, type CharacterCountStorage, DEFAULT_DATA_ATTRIBUTE, Dropcursor, type DropcursorOptions, Focus, type FocusOptions, Gapcursor, PLUGIN_KEY, Placeholder, type PlaceholderOptions, Selection, type SelectionOptions, TrailingNode, type TrailingNodeOptions, UndoRedo, type UndoRedoOptions, preparePlaceholderAttribute, skipTrailingNodeMeta };

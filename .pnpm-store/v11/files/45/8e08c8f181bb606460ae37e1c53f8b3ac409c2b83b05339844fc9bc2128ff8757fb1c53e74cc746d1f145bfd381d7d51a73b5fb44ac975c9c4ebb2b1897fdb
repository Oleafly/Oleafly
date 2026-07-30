import { Node, Extension, Editor, JSONContent } from '@tiptap/core';
import * as prosemirror_model from 'prosemirror-model';
import { NodeType, Node as Node$1 } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';

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

interface ListItemOptions {
    /**
     * The HTML attributes for a list item node.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
    /**
     * The node type for bulletList nodes
     * @default 'bulletList'
     * @example 'myCustomBulletList'
     */
    bulletListTypeName: string;
    /**
     * The node type for orderedList nodes
     * @default 'orderedList'
     * @example 'myCustomOrderedList'
     */
    orderedListTypeName: string;
}
/**
 * This extension allows you to create list items.
 * @see https://www.tiptap.dev/api/nodes/list-item
 */
declare const ListItem: Node<ListItemOptions, any>;

type ListKeymapOptions = {
    /**
     * An array of list types. This is used for item and wrapper list matching.
     * @default []
     * @example [{ itemName: 'listItem', wrapperNames: ['bulletList', 'orderedList'] }]
     */
    listTypes: Array<{
        itemName: string;
        wrapperNames: string[];
    }>;
};
/**
 * This extension registers custom keymaps to change the behaviour of the backspace and delete keys.
 * By default Prosemirror keyhandling will always lift or sink items so paragraphs are joined into
 * the adjacent or previous list item. This extension will prevent this behaviour and instead will
 * try to join paragraphs from two list items into a single list item.
 * @see https://www.tiptap.dev/api/extensions/list-keymap
 */
declare const ListKeymap: Extension<ListKeymapOptions, any>;

declare const findListItemPos: (typeOrName: string | NodeType, state: EditorState) => {
    $pos: prosemirror_model.ResolvedPos;
    depth: number;
} | null;

declare const getNextListDepth: (typeOrName: string, state: EditorState) => number | false;

declare const handleBackspace: (editor: Editor, name: string, parentListTypes: string[]) => boolean;

declare const handleDelete: (editor: Editor, name: string) => boolean;

declare const hasListBefore: (editorState: EditorState, name: string, parentListTypes: string[]) => boolean;

declare const hasListItemAfter: (typeOrName: string, state: EditorState) => boolean;

declare const hasListItemBefore: (typeOrName: string, state: EditorState) => boolean;

declare const listItemHasSubList: (typeOrName: string, state: EditorState, node?: Node$1) => boolean;

declare const nextListIsDeeper: (typeOrName: string, state: EditorState) => boolean;

declare const nextListIsHigher: (typeOrName: string, state: EditorState) => boolean;

declare const index_findListItemPos: typeof findListItemPos;
declare const index_getNextListDepth: typeof getNextListDepth;
declare const index_handleBackspace: typeof handleBackspace;
declare const index_handleDelete: typeof handleDelete;
declare const index_hasListBefore: typeof hasListBefore;
declare const index_hasListItemAfter: typeof hasListItemAfter;
declare const index_hasListItemBefore: typeof hasListItemBefore;
declare const index_listItemHasSubList: typeof listItemHasSubList;
declare const index_nextListIsDeeper: typeof nextListIsDeeper;
declare const index_nextListIsHigher: typeof nextListIsHigher;
declare namespace index {
  export { index_findListItemPos as findListItemPos, index_getNextListDepth as getNextListDepth, index_handleBackspace as handleBackspace, index_handleDelete as handleDelete, index_hasListBefore as hasListBefore, index_hasListItemAfter as hasListItemAfter, index_hasListItemBefore as hasListItemBefore, index_listItemHasSubList as listItemHasSubList, index_nextListIsDeeper as nextListIsDeeper, index_nextListIsHigher as nextListIsHigher };
}

interface OrderedListOptions {
    /**
     * The node type name for list items.
     * @default 'listItem'
     * @example 'myListItem'
     */
    itemTypeName: string;
    /**
     * The HTML attributes for an ordered list node.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
    /**
     * Keep the marks when splitting a list item.
     * @default false
     * @example true
     */
    keepMarks: boolean;
    /**
     * Keep the attributes when splitting a list item.
     * @default false
     * @example true
     */
    keepAttributes: boolean;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        orderedList: {
            /**
             * Toggle an ordered list
             * @example editor.commands.toggleOrderedList()
             */
            toggleOrderedList: () => ReturnType;
        };
    }
}
/**
 * Matches an ordered list to a 1. on input (or any number followed by a dot).
 */
declare const orderedListInputRegex: RegExp;
/**
 * This extension allows you to create ordered lists.
 * This requires the ListItem extension
 * @see https://www.tiptap.dev/api/nodes/ordered-list
 * @see https://www.tiptap.dev/api/nodes/list-item
 */
declare const OrderedList: Node<OrderedListOptions, any>;

/**
 * Marker segment for ordered list lines: numeric, roman, or 1–2 letter alpha.
 * Roman is matched before alpha so "iii" is roman; invalid romans like "aa" fall through to alpha.
 */
declare const ORDERED_LIST_MARKER_PATTERN: string;
/**
 * Convert a number to lowercase roman numerals.
 * @example toRoman(1) // 'i'
 * @example toRoman(4) // 'iv'
 */
declare function toRoman(num: number): string;
/**
 * Convert a number to uppercase roman numerals.
 * @example toRomanUpper(1) // 'I'
 * @example toRomanUpper(4) // 'IV'
 */
declare function toRomanUpper(num: number): string;
/**
 * Extract the list marker type from a marker string.
 * Supports "1", "a", "A", "i", "I" marker styles.
 *
 * @param marker The text content of the list marker (e.g. "a", "1", "iii", "b")
 * @returns The normalized type string, or undefined for default numeric type
 */
declare function detectMarkerType(marker: string): string | undefined;
/**
 * Convert a list marker string to its numeric start position.
 *
 * @param marker The text content of the list marker (e.g. "3", "b", "II")
 * @returns The 1-based start value for the ordered list
 */
declare function markerToStart(marker: string): number;
/**
 * Returns true when all markers share the same style and increment by 1.
 * Style is inferred from the first marker so ambiguous letters (e.g. "c", "i")
 * are not re-classified differently on later lines.
 */
declare function areOrderedListMarkersSequential(markers: string[]): boolean;
interface ParsedListMarker {
    type?: string;
    start: number;
}
/**
 * Parse a list marker into HTML ordered-list attrs (type + start).
 */
declare function parseListMarker(marker: string): ParsedListMarker;
/**
 * Build orderedList node attrs from the first list item marker.
 */
declare function buildOrderedListAttrsFromMarker(marker: string): Record<string, string | number>;
/**
 * Returns the list marker prefix for a given item at a given index.
 *
 * @param type The list type attribute (e.g. "a", "A", "i", "I", null/undefined for default)
 * @param index The zero-based index of the list item
 * @param separator The separator to use (default: ". ")
 * @returns The marker string (e.g. "a. ", "I. ", "1. ")
 */
declare function getListMarker(type: string | null | undefined, index: number, separator?: string): string;

/**
 * Parse plain-text pasted ordered list lines into JSONContent, or null if not a typed list.
 */
declare function parsePlainTextOrderedListPaste(text: string): JSONContent | null;

interface TaskItemOptions {
    /**
     * A callback function that is called when the checkbox is clicked while the editor is in readonly mode.
     * @param node The prosemirror node of the task item
     * @param checked The new checked state
     * @returns boolean
     */
    onReadOnlyChecked?: (node: Node$1, checked: boolean) => boolean;
    /**
     * Controls whether the task items can be nested or not.
     * @default false
     * @example true
     */
    nested: boolean;
    /**
     * HTML attributes to add to the task item element.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
    /**
     * The node type for taskList nodes
     * @default 'taskList'
     * @example 'myCustomTaskList'
     */
    taskListTypeName: string;
    /**
     * Accessibility options for the task item.
     * @default {}
     * @example
     * ```js
     * {
     *   checkboxLabel: (node) => `Task item: ${node.textContent || 'empty task item'}`
     * }
     */
    a11y?: {
        checkboxLabel?: (node: Node$1, checked: boolean) => string;
    };
}
/**
 * Matches a task item to a - [ ] on input.
 */
declare const inputRegex: RegExp;
/**
 * This extension allows you to create task items.
 * @see https://www.tiptap.dev/api/nodes/task-item
 */
declare const TaskItem: Node<TaskItemOptions, any>;

interface TaskListOptions {
    /**
     * The node type name for a task item.
     * @default 'taskItem'
     * @example 'myCustomTaskItem'
     */
    itemTypeName: string;
    /**
     * The HTML attributes for a task list node.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        taskList: {
            /**
             * Toggle a task list
             * @example editor.commands.toggleTaskList()
             */
            toggleTaskList: () => ReturnType;
        };
    }
}
/**
 * This extension allows you to create task lists.
 * @see https://www.tiptap.dev/api/nodes/task-list
 */
declare const TaskList: Node<TaskListOptions, any>;

interface ListKitOptions {
    /**
     * If set to false, the bulletList extension will not be registered
     * @example table: false
     */
    bulletList: Partial<BulletListOptions> | false;
    /**
     * If set to false, the listItem extension will not be registered
     */
    listItem: Partial<ListItemOptions> | false;
    /**
     * If set to false, the listKeymap extension will not be registered
     */
    listKeymap: Partial<ListKeymapOptions> | false;
    /**
     * If set to false, the orderedList extension will not be registered
     */
    orderedList: Partial<OrderedListOptions> | false;
    /**
     * If set to false, the taskItem extension will not be registered
     */
    taskItem: Partial<TaskItemOptions> | false;
    /**
     * If set to false, the taskList extension will not be registered
     */
    taskList: Partial<TaskListOptions> | false;
}
/**
 * The table kit is a collection of table editor extensions.
 *
 * It’s a good starting point for building your own table in Tiptap.
 */
declare const ListKit: Extension<ListKitOptions, any>;

export { BulletList, type BulletListOptions, ListItem, type ListItemOptions, ListKeymap, type ListKeymapOptions, ListKit, type ListKitOptions, ORDERED_LIST_MARKER_PATTERN, OrderedList, type OrderedListOptions, TaskItem, type TaskItemOptions, TaskList, type TaskListOptions, areOrderedListMarkersSequential, buildOrderedListAttrsFromMarker, bulletListInputRegex, detectMarkerType, getListMarker, inputRegex, index as listHelpers, markerToStart, orderedListInputRegex, parseListMarker, parsePlainTextOrderedListPaste, toRoman, toRomanUpper };

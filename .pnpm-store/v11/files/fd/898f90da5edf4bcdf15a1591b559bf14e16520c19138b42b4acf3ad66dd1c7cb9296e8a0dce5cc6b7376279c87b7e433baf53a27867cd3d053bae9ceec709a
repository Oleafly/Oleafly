import { Extension } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';

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

interface TaskItemOptions {
    /**
     * A callback function that is called when the checkbox is clicked while the editor is in readonly mode.
     * @param node The prosemirror node of the task item
     * @param checked The new checked state
     * @returns boolean
     */
    onReadOnlyChecked?: (node: Node, checked: boolean) => boolean;
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
        checkboxLabel?: (node: Node, checked: boolean) => string;
    };
}

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

export { ListKit, type ListKitOptions };

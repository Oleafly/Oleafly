import { Node } from '@tiptap/core';

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

export { TaskList, type TaskListOptions };

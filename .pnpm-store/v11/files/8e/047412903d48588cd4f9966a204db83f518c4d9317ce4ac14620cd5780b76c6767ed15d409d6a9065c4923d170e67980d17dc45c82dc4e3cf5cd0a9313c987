import { Extension, Editor } from '@tiptap/core';
import * as prosemirror_model from 'prosemirror-model';
import { NodeType, Node } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';

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

declare const listItemHasSubList: (typeOrName: string, state: EditorState, node?: Node) => boolean;

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

export { ListKeymap, type ListKeymapOptions, index as listHelpers };

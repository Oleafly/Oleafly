import { Node, JSONContent } from '@tiptap/core';

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

export { ORDERED_LIST_MARKER_PATTERN, OrderedList, type OrderedListOptions, areOrderedListMarkersSequential, buildOrderedListAttrsFromMarker, detectMarkerType, getListMarker, markerToStart, orderedListInputRegex, parseListMarker, parsePlainTextOrderedListPaste, toRoman, toRomanUpper };

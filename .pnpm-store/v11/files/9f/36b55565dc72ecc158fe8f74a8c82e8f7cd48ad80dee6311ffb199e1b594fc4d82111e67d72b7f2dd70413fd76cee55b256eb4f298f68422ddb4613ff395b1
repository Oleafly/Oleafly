/**
 * @typedef {import('mdast').Nodes} Nodes
 * @typedef {import('mdast-util-find-and-replace').ReplaceFunction} ReplaceFunction
 */

import {findAndReplace} from 'mdast-util-find-and-replace'

/**
 * Turn normal line endings into hard breaks.
 *
 * @param {Nodes} tree
 *   Tree to change.
 * @returns {undefined}
 *   Nothing.
 */
export function newlineToBreak(tree) {
  findAndReplace(tree, [/\r?\n|\r/g, replace])
}

/**
 * Replace line endings.
 *
 * @type {ReplaceFunction}
 */
function replace() {
  return {type: 'break'}
}

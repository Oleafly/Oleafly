/**
 * @typedef {import('mdast').Root} Root
 */

import {newlineToBreak} from 'mdast-util-newline-to-break'

/**
 * Support hard breaks without needing spaces or escapes (turns enters into
 * `<br>`s).
 *
 * @returns
 *   Transform.
 */
export default function remarkBreaks() {
  /**
   * Transform.
   *
   * @param {Root} tree
   *   Tree.
   * @returns {undefined}
   *   Nothing.
   */
  return function (tree) {
    newlineToBreak(tree)
  }
}

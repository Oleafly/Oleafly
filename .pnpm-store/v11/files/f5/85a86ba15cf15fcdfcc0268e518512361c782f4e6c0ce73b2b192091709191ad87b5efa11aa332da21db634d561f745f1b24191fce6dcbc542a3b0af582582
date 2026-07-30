import { getParentNode, isHTMLElement, isLastTraversableNode } from '@floating-ui/utils/dom';
export function findRootOwnerId(node) {
  if (isHTMLElement(node) && node.hasAttribute('data-rootownerid')) {
    return node.getAttribute('data-rootownerid') ?? undefined;
  }
  if (isLastTraversableNode(node)) {
    return undefined;
  }
  return findRootOwnerId(getParentNode(node));
}
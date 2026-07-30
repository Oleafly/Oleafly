'use client';

import * as React from 'react';
import { REGULAR_ITEM, useMenuItem } from "./useMenuItem.mjs";
import { useMenuRootContext } from "../root/MenuRootContext.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useBaseUiId } from "../../internals/useBaseUiId.mjs";
import { useCompositeListItem } from "../../internals/composite/list/useCompositeListItem.mjs";
import { useMenuPositionerContext } from "../positioner/MenuPositionerContext.mjs";

/**
 * An individual interactive item in the menu.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Menu](https://base-ui.com/react/components/menu)
 */
export const MenuItem = /*#__PURE__*/React.forwardRef(function MenuItem(componentProps, forwardedRef) {
  const {
    render,
    className,
    id: idProp,
    label,
    nativeButton = false,
    disabled = false,
    closeOnClick = true,
    style,
    ...elementProps
  } = componentProps;
  const listItem = useCompositeListItem({
    label
  });
  const menuPositionerContext = useMenuPositionerContext(true);
  const id = useBaseUiId(idProp);
  const {
    store
  } = useMenuRootContext();
  const highlighted = store.useState('isActive', listItem.index);
  const itemProps = store.useState('itemProps');
  const {
    getItemProps,
    itemRef
  } = useMenuItem({
    closeOnClick,
    disabled,
    highlighted,
    id,
    store,
    nativeButton,
    nodeId: menuPositionerContext?.context.nodeId,
    itemMetadata: REGULAR_ITEM
  });
  const state = {
    disabled,
    highlighted
  };
  return useRenderElement('div', componentProps, {
    state,
    props: [itemProps, elementProps, getItemProps],
    ref: [itemRef, forwardedRef, listItem.ref]
  });
});
if (process.env.NODE_ENV !== "production") MenuItem.displayName = "MenuItem";
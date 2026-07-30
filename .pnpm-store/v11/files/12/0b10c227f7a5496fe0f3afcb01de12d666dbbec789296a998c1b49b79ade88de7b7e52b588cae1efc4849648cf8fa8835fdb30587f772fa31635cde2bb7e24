import { createContext, memo, use, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Accordion/context.tsx
/**
* Per-item context: each AccordionItem gets its own provider, so a toggle
* only invalidates the value seen by that single item. Sibling items keep
* the same context value identity and skip re-render.
*/
const AccordionItemStateContext = createContext(null);
/**
* Static config shared by all items. Identity changes only when the user
* changes config props on <Accordion>, which is rare.
*/
const AccordionConfigContext = createContext(null);
const useAccordionItemState = () => use(AccordionItemStateContext);
const useAccordionConfig = () => use(AccordionConfigContext);
const AccordionItemStateProvider = memo(({ children, expandedKeys, isOpenKey, isOpen, itemKey, onToggleKey, onToggleKeys, preferProviderKeyForNestedItems }) => {
	const value = useMemo(() => ({
		isOpenKey,
		isOpen,
		itemKey,
		onToggle: () => onToggleKey(itemKey),
		onToggleKey,
		onToggleNestedKey: (key) => onToggleKeys([itemKey, key], preferProviderKeyForNestedItems ? itemKey : key)
	}), [
		expandedKeys,
		isOpenKey,
		isOpen,
		itemKey,
		onToggleKey,
		onToggleKeys,
		preferProviderKeyForNestedItems
	]);
	return /* @__PURE__ */ jsx(AccordionItemStateContext, {
		value,
		children
	});
});
AccordionItemStateProvider.displayName = "AccordionItemStateProvider";
//#endregion
export { AccordionConfigContext, AccordionItemStateContext, AccordionItemStateProvider, useAccordionConfig, useAccordionItemState };

//# sourceMappingURL=context.mjs.map
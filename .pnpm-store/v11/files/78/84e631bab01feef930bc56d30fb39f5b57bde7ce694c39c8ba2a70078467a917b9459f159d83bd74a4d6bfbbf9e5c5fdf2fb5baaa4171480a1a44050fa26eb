"use client";
import { createContext, use } from "react";
//#region src/hooks/useFloatingLayer.tsx
/**
* Context for managing floating layer stacking.
* When a component like Popover opens, it can provide its container
* so that nested floating elements (like Tooltip) can render into it,
* avoiding z-index stacking context issues.
*/
const FloatingLayerContext = createContext(null);
/**
* Hook to get the current floating layer container.
* Returns the nearest floating layer container from context, or null if none exists.
*/
const useFloatingLayer = () => {
	return use(FloatingLayerContext);
};
/**
* Provider component for floating layer context.
*/
const FloatingLayerProvider = FloatingLayerContext.Provider;
//#endregion
export { FloatingLayerContext, FloatingLayerProvider, useFloatingLayer };

//# sourceMappingURL=useFloatingLayer.mjs.map
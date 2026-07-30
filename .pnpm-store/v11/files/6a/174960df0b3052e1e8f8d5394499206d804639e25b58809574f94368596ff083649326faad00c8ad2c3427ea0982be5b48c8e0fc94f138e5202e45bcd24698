import { useSyncExternalStore } from "react";
//#region src/react.ts
/**
* React bindings for @pierre/theming. A thin useSyncExternalStore wrapper over
* the framework-agnostic controller with no logic of its own — all state,
* persistence, and resolution live in the controller, so a non-React app can use
* it directly. React is an optional peer dependency; importing this entry is the
* only place React is required.
*/
function useThemeController(controller) {
	return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}
//#endregion
export { useThemeController };

//# sourceMappingURL=react.js.map
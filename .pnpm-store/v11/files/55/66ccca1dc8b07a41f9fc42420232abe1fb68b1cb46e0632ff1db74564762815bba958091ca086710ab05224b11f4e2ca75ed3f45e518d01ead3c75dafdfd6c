import { areOptionsEqual } from "../../utils/areOptionsEqual.js";
import { FileDiff } from "../../components/FileDiff.js";
import { VirtualizedFileDiff } from "../../components/VirtualizedFileDiff.js";
import { noopRender } from "../constants.js";
import { useStableCallback } from "./useStableCallback.js";
import { WorkerPoolContext } from "../WorkerPoolContext.js";
import { useVirtualizer } from "../Virtualizer.js";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
//#region src/react/utils/useFileDiffInstance.ts
const useIsometricEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
function useFileDiffInstance({ fileDiff, options, lineAnnotations, selectedLines, prerenderedHTML, metrics, hasGutterRenderUtility, hasCustomHeader, disableWorkerPool }) {
	const simpleVirtualizer = useVirtualizer();
	const controlledSelection = selectedLines !== void 0;
	const poolManager = useContext(WorkerPoolContext);
	const instanceRef = useRef(null);
	const ref = useStableCallback((fileContainer) => {
		if (fileContainer != null) {
			if (instanceRef.current != null) throw new Error("useFileDiffInstance: An instance should not already exist when a node is created");
			if (simpleVirtualizer != null) instanceRef.current = new VirtualizedFileDiff(mergeFileDiffOptions({
				controlledSelection,
				hasCustomHeader,
				hasGutterRenderUtility,
				options
			}), simpleVirtualizer, metrics, !disableWorkerPool ? poolManager : void 0, true);
			else instanceRef.current = new FileDiff(mergeFileDiffOptions({
				controlledSelection,
				hasCustomHeader,
				hasGutterRenderUtility,
				options
			}), !disableWorkerPool ? poolManager : void 0, true);
			instanceRef.current.hydrate({
				fileDiff,
				fileContainer,
				lineAnnotations,
				prerenderedHTML
			});
		} else {
			if (instanceRef.current == null) throw new Error("useFileDiffInstance: A FileDiff instance should exist when unmounting");
			instanceRef.current.cleanUp();
			instanceRef.current = null;
		}
	});
	useIsometricEffect(() => {
		const { current: instance } = instanceRef;
		if (instance == null) return;
		const newOptions = mergeFileDiffOptions({
			controlledSelection,
			hasCustomHeader,
			hasGutterRenderUtility,
			options
		});
		const forceRender = !areOptionsEqual(instance.options, newOptions);
		instance.setOptions(newOptions);
		instance.render({
			forceRender,
			fileDiff,
			lineAnnotations
		});
		if (selectedLines !== void 0) instance.setSelectedLines(selectedLines);
	});
	return {
		ref,
		getHoveredLine: useCallback(() => {
			return instanceRef.current?.getHoveredLine();
		}, [])
	};
}
function mergeFileDiffOptions({ options, controlledSelection, hasCustomHeader, hasGutterRenderUtility }) {
	if (!controlledSelection && !hasGutterRenderUtility && !hasCustomHeader) return options;
	return {
		...options,
		controlledSelection,
		renderCustomHeader: hasCustomHeader ? noopRender : options?.renderCustomHeader,
		renderGutterUtility: hasGutterRenderUtility ? noopRender : options?.renderGutterUtility
	};
}
//#endregion
export { useFileDiffInstance };

//# sourceMappingURL=useFileDiffInstance.js.map
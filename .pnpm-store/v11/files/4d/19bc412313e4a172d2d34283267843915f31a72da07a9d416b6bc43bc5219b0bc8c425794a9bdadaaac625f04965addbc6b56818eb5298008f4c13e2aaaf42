import { areOptionsEqual } from "../../utils/areOptionsEqual.js";
import { File } from "../../components/File.js";
import { VirtualizedFile } from "../../components/VirtualizedFile.js";
import { noopRender } from "../constants.js";
import { useStableCallback } from "./useStableCallback.js";
import { WorkerPoolContext } from "../WorkerPoolContext.js";
import { useVirtualizer } from "../Virtualizer.js";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
//#region src/react/utils/useFileInstance.ts
const useIsometricEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
function useFileInstance({ file, options, lineAnnotations, selectedLines, prerenderedHTML, metrics, hasGutterRenderUtility, hasCustomHeader, disableWorkerPool }) {
	const simpleVirtualizer = useVirtualizer();
	const controlledSelection = selectedLines !== void 0;
	const poolManager = useContext(WorkerPoolContext);
	const instanceRef = useRef(null);
	const ref = useStableCallback((node) => {
		if (node != null) {
			if (instanceRef.current != null) throw new Error("File: An instance should not already exist when a node is created");
			if (simpleVirtualizer != null) instanceRef.current = new VirtualizedFile(mergeFileOptions({
				controlledSelection,
				hasCustomHeader,
				hasGutterRenderUtility,
				options
			}), simpleVirtualizer, metrics, !disableWorkerPool ? poolManager : void 0, true);
			else instanceRef.current = new File(mergeFileOptions({
				controlledSelection,
				hasCustomHeader,
				hasGutterRenderUtility,
				options
			}), !disableWorkerPool ? poolManager : void 0, true);
			instanceRef.current.hydrate({
				file,
				fileContainer: node,
				lineAnnotations,
				prerenderedHTML
			});
		} else {
			if (instanceRef.current == null) throw new Error("File: A File instance should exist when unmounting");
			instanceRef.current.cleanUp();
			instanceRef.current = null;
		}
	});
	useIsometricEffect(() => {
		if (instanceRef.current == null) return;
		const newOptions = mergeFileOptions({
			controlledSelection,
			hasCustomHeader,
			hasGutterRenderUtility,
			options
		});
		const forceRender = !areOptionsEqual(instanceRef.current.options, newOptions);
		instanceRef.current.setOptions(newOptions);
		instanceRef.current.render({
			file,
			lineAnnotations,
			forceRender
		});
		if (selectedLines !== void 0) instanceRef.current.setSelectedLines(selectedLines);
	});
	return {
		ref,
		getHoveredLine: useCallback(() => {
			return instanceRef.current?.getHoveredLine();
		}, [])
	};
}
function mergeFileOptions({ options, controlledSelection, hasCustomHeader, hasGutterRenderUtility }) {
	if (!controlledSelection && !hasGutterRenderUtility && !hasCustomHeader) return options;
	return {
		...options,
		controlledSelection,
		renderCustomHeader: hasCustomHeader ? noopRender : options?.renderCustomHeader,
		renderGutterUtility: hasGutterRenderUtility ? noopRender : options?.renderGutterUtility
	};
}
//#endregion
export { useFileInstance };

//# sourceMappingURL=useFileInstance.js.map
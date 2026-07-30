import { areOptionsEqual } from "../../utils/areOptionsEqual.js";
import { parseMergeConflictDiffFromFile } from "../../utils/parseMergeConflictDiffFromFile.js";
import { UnresolvedFile } from "../../components/UnresolvedFile.js";
import { noopRender } from "../constants.js";
import { useStableCallback } from "./useStableCallback.js";
import { WorkerPoolContext } from "../WorkerPoolContext.js";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
//#region src/react/utils/useUnresolvedFileInstance.ts
const useIsometricEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
function useUnresolvedFileInstance({ file, options, lineAnnotations, selectedLines, prerenderedHTML, hasConflictUtility, hasGutterRenderUtility, hasCustomHeader, disableWorkerPool }) {
	const [{ fileDiff, actions, markerRows }, setState] = useState(() => {
		const { fileDiff, actions, markerRows } = parseMergeConflictDiffFromFile(file, options?.maxContextLines);
		return {
			fileDiff,
			actions,
			markerRows
		};
	});
	const onMergeConflictAction = useStableCallback((payload, instance) => {
		setState((prevState) => {
			const { fileDiff, actions, markerRows } = instance.resolveConflict(payload.conflict.conflictIndex, payload.resolution, prevState.fileDiff) ?? {};
			if (fileDiff == null || actions == null || markerRows == null) return prevState;
			else return {
				fileDiff,
				actions,
				markerRows
			};
		});
	});
	const controlledSelection = selectedLines !== void 0;
	const poolManager = useContext(WorkerPoolContext);
	const instanceRef = useRef(null);
	const ref = useStableCallback((fileContainer) => {
		if (fileContainer != null) {
			if (instanceRef.current != null) throw new Error("useUnresolvedFileInstance: An instance should not already exist when a node is created");
			instanceRef.current = new UnresolvedFile(mergeUnresolvedOptions({
				controlledSelection,
				hasConflictUtility,
				hasCustomHeader,
				hasGutterRenderUtility,
				onMergeConflictAction,
				options
			}), !disableWorkerPool ? poolManager : void 0, true);
			instanceRef.current.hydrate({
				fileDiff,
				actions,
				markerRows,
				fileContainer,
				lineAnnotations,
				prerenderedHTML
			});
		} else {
			if (instanceRef.current == null) throw new Error("useUnresolvedFileInstance: A UnresolvedFile instance should exist when unmounting");
			instanceRef.current.cleanUp();
			instanceRef.current = null;
		}
	});
	useIsometricEffect(() => {
		if (instanceRef.current == null) return;
		const instance = instanceRef.current;
		const newOptions = mergeUnresolvedOptions({
			controlledSelection,
			hasConflictUtility,
			hasCustomHeader,
			hasGutterRenderUtility,
			onMergeConflictAction,
			options
		});
		const forceRender = !areOptionsEqual(instance.options, newOptions);
		instance.setOptions(newOptions);
		instance.render({
			fileDiff,
			actions,
			markerRows,
			lineAnnotations,
			forceRender
		});
		if (selectedLines !== void 0) instance.setSelectedLines(selectedLines);
	});
	return {
		ref,
		getHoveredLine: useCallback(() => {
			return instanceRef.current?.getHoveredLine();
		}, []),
		fileDiff,
		actions,
		markerRows,
		getInstance: useCallback(() => {
			return instanceRef.current ?? void 0;
		}, [])
	};
}
function mergeUnresolvedOptions({ options, controlledSelection, onMergeConflictAction, hasConflictUtility, hasCustomHeader, hasGutterRenderUtility }) {
	return {
		...options,
		controlledSelection,
		onMergeConflictAction,
		hunkSeparators: options?.hunkSeparators === "custom" ? noopRender : options?.hunkSeparators,
		mergeConflictActionsType: hasConflictUtility || options?.mergeConflictActionsType === "custom" ? noopRender : options?.mergeConflictActionsType,
		renderCustomHeader: hasCustomHeader ? noopRender : void 0,
		renderGutterUtility: hasGutterRenderUtility ? noopRender : void 0
	};
}
//#endregion
export { useUnresolvedFileInstance };

//# sourceMappingURL=useUnresolvedFileInstance.js.map
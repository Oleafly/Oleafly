import { parsePatchFiles } from "../utils/parsePatchFiles.js";
import { preloadFileDiff } from "./preloadDiffs.js";
//#region src/ssr/preloadPatchFile.ts
async function preloadPatchFile({ patch, options }) {
	const diffs = [];
	const patches = parsePatchFiles(patch);
	for (const patch of patches) for (const fileDiff of patch.files) diffs.push(preloadFileDiff({
		fileDiff,
		options
	}));
	return await Promise.all(diffs);
}
//#endregion
export { preloadPatchFile };

//# sourceMappingURL=preloadPatchFile.js.map
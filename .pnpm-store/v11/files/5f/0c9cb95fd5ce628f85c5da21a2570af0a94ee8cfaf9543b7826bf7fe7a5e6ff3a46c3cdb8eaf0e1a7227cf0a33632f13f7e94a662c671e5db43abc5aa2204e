import { processFile } from "./parsePatchFiles.js";
import { createTwoFilesPatch } from "diff";
//#region src/utils/parseDiffFromFile.ts
/**
* Parses a diff from two file contents objects.
*
* If both `oldFile` and `newFile` have a `cacheKey`, the resulting diff will
* automatically get a combined cache key in the format `oldKey:newKey`.
*/
function parseDiffFromFile(oldFile, newFile, options, throwOnError = false) {
	const fileData = processFile(createTwoFilesPatch(oldFile.name, newFile.name, oldFile.contents, newFile.contents, oldFile.header, newFile.header, options), {
		cacheKey: (() => {
			if (oldFile.cacheKey != null && newFile.cacheKey != null) return `${oldFile.cacheKey}:${newFile.cacheKey}`;
		})(),
		oldFile,
		newFile,
		throwOnError
	});
	if (fileData == null) throw new Error("parseDiffFrom: FileInvalid diff -- probably need to fix something -- if the files are the same maybe?");
	if (newFile.lang != null) fileData.lang = newFile.lang;
	return fileData;
}
//#endregion
export { parseDiffFromFile };

//# sourceMappingURL=parseDiffFromFile.js.map
import { ALTERNATE_FILE_NAMES_GIT, COMMIT_METADATA_SPLIT, FILENAME_HEADER_REGEX, FILENAME_HEADER_REGEX_GIT, GIT_DIFF_FILE_BREAK_REGEX, INDEX_LINE_METADATA } from "../constants.js";
import { cleanLastNewline } from "./cleanLastNewline.js";
import { detachString, releaseStringDetachBuffer } from "./detachString.js";
//#region src/utils/parsePatchFiles.ts
function processPatch(data, cacheKeyPrefix, throwOnError) {
	try {
		return _processPatch(data, cacheKeyPrefix, throwOnError);
	} finally {
		releaseStringDetachBuffer();
	}
}
function _processPatch(data, cacheKeyPrefix, throwOnError = false) {
	const isGitDiff = isGitDiffPatch(data);
	const rawFiles = isGitDiff ? splitGitDiffFiles(data) : splitUnifiedDiffFiles(data);
	let patchMetadata;
	const files = [];
	for (const fileOrPatchMetadata of rawFiles) {
		if (isGitDiff && !GIT_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)) {
			if (patchMetadata == null) patchMetadata = detachString(fileOrPatchMetadata);
			else if (throwOnError) throw Error("parsePatchContent: unknown file blob");
			else console.error("parsePatchContent: unknown file blob:", fileOrPatchMetadata);
			continue;
		} else if (!isGitDiff && !startsWithUnifiedDiffFileHeader(fileOrPatchMetadata)) {
			if (patchMetadata == null) patchMetadata = detachString(fileOrPatchMetadata);
			else if (throwOnError) throw Error("parsePatchContent: unknown file blob");
			else console.error("parsePatchContent: unknown file blob:", fileOrPatchMetadata);
			continue;
		}
		const currentFile = _processFile(fileOrPatchMetadata, {
			cacheKey: cacheKeyPrefix != null ? `${cacheKeyPrefix}-${files.length}` : void 0,
			isGitDiff,
			throwOnError
		});
		if (currentFile != null) files.push(currentFile);
	}
	return {
		patchMetadata,
		files
	};
}
function processFile(fileDiffString, options) {
	try {
		return _processFile(fileDiffString, options);
	} finally {
		releaseStringDetachBuffer();
	}
}
function _processFile(fileDiffString, { cacheKey, isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(fileDiffString), oldFile, newFile, throwOnError = false } = {}) {
	let lastHunkEnd = 0;
	const hunks = splitAtLinePrefix(fileDiffString, "@@ ");
	let currentFile;
	const isPartial = oldFile == null || newFile == null;
	let deletionLineIndex = 0;
	let additionLineIndex = 0;
	for (const hunk of hunks) {
		const lines = splitWithNewlines(hunk);
		const firstLine = lines[0];
		if (firstLine == null) {
			if (throwOnError) throw Error("parsePatchContent: invalid hunk");
			else console.error("parsePatchContent: invalid hunk", hunk);
			continue;
		}
		const fileHeader = parseHunkHeader(firstLine);
		let additionLines = 0;
		let deletionLines = 0;
		if (fileHeader == null || currentFile == null) {
			if (currentFile != null) {
				if (throwOnError) throw Error("parsePatchContent: Invalid hunk");
				else console.error("parsePatchContent: Invalid hunk", hunk);
				continue;
			}
			currentFile = {
				name: "",
				type: "change",
				hunks: [],
				splitLineCount: 0,
				unifiedLineCount: 0,
				isPartial,
				additionLines: !isPartial && oldFile != null && newFile != null ? splitFileContents(newFile.contents) : [],
				deletionLines: !isPartial && oldFile != null && newFile != null ? splitFileContents(oldFile.contents) : [],
				cacheKey: maybeDetachOptionalString(cacheKey)
			};
			if (currentFile.additionLines.length === 1 && newFile?.contents === "") currentFile.additionLines.length = 0;
			if (currentFile.deletionLines.length === 1 && oldFile?.contents === "") currentFile.deletionLines.length = 0;
			for (const line of lines) {
				if (line.startsWith("diff --git")) {
					const filenameMatch = line.trim().match(ALTERNATE_FILE_NAMES_GIT);
					const prevName = filenameMatch?.[1] ?? filenameMatch?.[2];
					const name = filenameMatch?.[3] ?? filenameMatch?.[4];
					if (prevName == null || name == null) {
						if (throwOnError) throw Error("parsePatchContent: invalid git diff header");
						else console.error("parsePatchContent: invalid git diff header", line);
						continue;
					}
					currentFile.name = detachString(name.trim());
					if (prevName !== name) currentFile.prevName = detachString(prevName.trim());
					continue;
				}
				const filenameMatch = line.startsWith("---") || line.startsWith("+++") ? line.match(isGitDiff ? FILENAME_HEADER_REGEX_GIT : FILENAME_HEADER_REGEX) : null;
				if (filenameMatch != null) {
					const [, type, fileName] = filenameMatch;
					if (type === "---" && fileName !== "/dev/null") {
						const detachedFileName = detachString(fileName.trim());
						currentFile.prevName = detachedFileName;
						currentFile.name = detachedFileName;
					} else if (type === "+++" && fileName !== "/dev/null") currentFile.name = detachString(fileName.trim());
				} else if (isGitDiff) {
					if (line.startsWith("new mode ")) currentFile.mode = detachString(line.slice(8).trim());
					if (line.startsWith("old mode ")) currentFile.prevMode = detachString(line.slice(8).trim());
					if (line.startsWith("new file mode")) {
						currentFile.type = "new";
						currentFile.mode = detachString(line.slice(13).trim());
					}
					if (line.startsWith("deleted file mode")) {
						currentFile.type = "deleted";
						currentFile.mode = detachString(line.slice(17).trim());
					}
					if (line.startsWith("similarity index")) if (line.startsWith("similarity index 100%")) currentFile.type = "rename-pure";
					else currentFile.type = "rename-changed";
					if (line.startsWith("index ")) {
						const [, prevObjectId, newObjectId, mode] = line.trim().match(INDEX_LINE_METADATA) ?? [];
						if (prevObjectId != null) currentFile.prevObjectId = detachString(prevObjectId);
						if (newObjectId != null) currentFile.newObjectId = detachString(newObjectId);
						if (mode != null) currentFile.mode = detachString(mode);
					}
					if (line.startsWith("rename from ")) currentFile.prevName = detachString(line.slice(12).trim());
					if (line.startsWith("rename to ")) currentFile.name = detachString(line.slice(10).trim());
				}
			}
			continue;
		}
		let currentContent;
		let lastLineType;
		while (lines.length > 0 && (lines[lines.length - 1] === "\n" || lines[lines.length - 1] === "\r" || lines[lines.length - 1] === "\r\n" || lines[lines.length - 1] === "")) lines.pop();
		const { additionStart, deletionStart } = fileHeader;
		deletionLineIndex = isPartial ? deletionLineIndex : deletionStart - 1;
		additionLineIndex = isPartial ? additionLineIndex : additionStart - 1;
		const hunkData = {
			collapsedBefore: 0,
			splitLineCount: 0,
			splitLineStart: 0,
			unifiedLineCount: 0,
			unifiedLineStart: 0,
			additionCount: fileHeader.additionCount,
			additionStart,
			additionLines,
			deletionCount: fileHeader.deletionCount,
			deletionStart,
			deletionLines,
			deletionLineIndex,
			additionLineIndex,
			hunkContent: [],
			hunkContext: maybeDetachOptionalString(fileHeader.hunkContext),
			hunkSpecs: detachString(firstLine),
			noEOFCRAdditions: false,
			noEOFCRDeletions: false
		};
		let parsedAdditionLines = 0;
		let parsedDeletionLines = 0;
		for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
			const rawLine = lines[lineIndex];
			if (parsedAdditionLines >= hunkData.additionCount && parsedDeletionLines >= hunkData.deletionCount && !rawLine.startsWith("\\")) {
				if (throwOnError && isHunkBodyLine(rawLine) && !isFormatPatchVersionSeparator(rawLine)) throw Error("parsePatchContent: hunk has more lines than expected");
				break;
			}
			const firstChar = rawLine[0];
			if (firstChar !== "+" && firstChar !== "-" && firstChar !== " " && firstChar !== "\\") {
				if (throwOnError) throw Error("parsePatchContent: invalid hunk line");
				console.error(`parseLineType: Invalid firstChar: "${firstChar}", full line: "${rawLine}"`);
				console.error("processFile: invalid rawLine:", rawLine);
				continue;
			}
			const type = parseRawLineType(firstChar);
			if (type === "addition") {
				if (throwOnError && parsedAdditionLines >= hunkData.additionCount) throw Error("parsePatchContent: hunk has too many addition lines");
				const line = getParsedLineContent(rawLine);
				if (currentContent == null || currentContent.type !== "change") {
					currentContent = createContentGroup("change", deletionLineIndex, additionLineIndex);
					hunkData.hunkContent.push(currentContent);
				}
				additionLineIndex++;
				parsedAdditionLines++;
				if (isPartial) currentFile.additionLines.push(line);
				currentContent.additions++;
				additionLines++;
				lastLineType = "addition";
			} else if (type === "deletion") {
				if (throwOnError && parsedDeletionLines >= hunkData.deletionCount) throw Error("parsePatchContent: hunk has too many deletion lines");
				const line = getParsedLineContent(rawLine);
				if (currentContent == null || currentContent.type !== "change") {
					currentContent = createContentGroup("change", deletionLineIndex, additionLineIndex);
					hunkData.hunkContent.push(currentContent);
				}
				deletionLineIndex++;
				parsedDeletionLines++;
				if (isPartial) currentFile.deletionLines.push(line);
				currentContent.deletions++;
				deletionLines++;
				lastLineType = "deletion";
			} else if (type === "context") {
				if (throwOnError && (parsedDeletionLines >= hunkData.deletionCount || parsedAdditionLines >= hunkData.additionCount)) throw Error("parsePatchContent: hunk has too many context lines");
				const line = getParsedLineContent(rawLine);
				if (currentContent == null || currentContent.type !== "context") {
					currentContent = createContentGroup("context", deletionLineIndex, additionLineIndex);
					hunkData.hunkContent.push(currentContent);
				}
				additionLineIndex++;
				deletionLineIndex++;
				parsedAdditionLines++;
				parsedDeletionLines++;
				if (isPartial) {
					currentFile.deletionLines.push(line);
					currentFile.additionLines.push(line);
				}
				currentContent.lines++;
				lastLineType = "context";
			} else if (type === "metadata" && currentContent != null) {
				if (currentContent.type === "context") {
					hunkData.noEOFCRAdditions = true;
					hunkData.noEOFCRDeletions = true;
				} else if (lastLineType === "deletion") hunkData.noEOFCRDeletions = true;
				else if (lastLineType === "addition") hunkData.noEOFCRAdditions = true;
				if (isPartial && (lastLineType === "addition" || lastLineType === "context")) {
					const lastIndex = currentFile.additionLines.length - 1;
					if (lastIndex >= 0) currentFile.additionLines[lastIndex] = cleanLastNewline(currentFile.additionLines[lastIndex]);
				}
				if (isPartial && (lastLineType === "deletion" || lastLineType === "context")) {
					const lastIndex = currentFile.deletionLines.length - 1;
					if (lastIndex >= 0) currentFile.deletionLines[lastIndex] = cleanLastNewline(currentFile.deletionLines[lastIndex]);
				}
			}
		}
		if (throwOnError && (parsedAdditionLines !== hunkData.additionCount || parsedDeletionLines !== hunkData.deletionCount)) throw Error("parsePatchContent: hunk line count mismatch");
		hunkData.additionLines = additionLines;
		hunkData.deletionLines = deletionLines;
		hunkData.collapsedBefore = Math.max(hunkData.additionStart - 1 - lastHunkEnd, 0);
		currentFile.hunks.push(hunkData);
		lastHunkEnd = hunkData.additionStart + hunkData.additionCount - 1;
		for (const content of hunkData.hunkContent) if (content.type === "context") {
			hunkData.splitLineCount += content.lines;
			hunkData.unifiedLineCount += content.lines;
		} else {
			hunkData.splitLineCount += Math.max(content.additions, content.deletions);
			hunkData.unifiedLineCount += content.deletions + content.additions;
		}
		hunkData.splitLineStart = currentFile.splitLineCount + hunkData.collapsedBefore;
		hunkData.unifiedLineStart = currentFile.unifiedLineCount + hunkData.collapsedBefore;
		currentFile.splitLineCount += hunkData.collapsedBefore + hunkData.splitLineCount;
		currentFile.unifiedLineCount += hunkData.collapsedBefore + hunkData.unifiedLineCount;
	}
	if (currentFile == null) return;
	if (throwOnError && isPartial && !isGitDiff && currentFile.hunks.length === 0) throw Error("parsePatchContent: unified file has no hunks");
	if (currentFile.hunks.length > 0 && !isPartial && currentFile.additionLines.length > 0 && currentFile.deletionLines.length > 0) {
		const lastHunk = currentFile.hunks[currentFile.hunks.length - 1];
		const lastHunkEnd = lastHunk.additionStart + lastHunk.additionCount - 1;
		const totalFileLines = currentFile.additionLines.length;
		const collapsedAfter = Math.max(totalFileLines - lastHunkEnd, 0);
		currentFile.splitLineCount += collapsedAfter;
		currentFile.unifiedLineCount += collapsedAfter;
	}
	if (!isGitDiff) {
		if (currentFile.prevName != null && currentFile.name !== currentFile.prevName) if (currentFile.hunks.length > 0) currentFile.type = "rename-changed";
		else currentFile.type = "rename-pure";
		else if ((oldFile == null || oldFile.contents === "") && newFile != null && newFile.contents !== "") currentFile.type = "new";
		else if (oldFile != null && oldFile.contents !== "" && (newFile == null || newFile.contents === "")) currentFile.type = "deleted";
	}
	if (currentFile.type !== "rename-pure" && currentFile.type !== "rename-changed") currentFile.prevName = void 0;
	return currentFile;
}
/**
* Parses a patch file string into an array of parsed patches.
*
* @param data - The raw patch file content (supports multi-commit patches)
* @param cacheKeyPrefix - Optional prefix for generating cache keys. When provided,
*   each file in the patch will get a cache key in the format `prefix-patchIndex-fileIndex`.
*   This enables caching of rendered diff results in the worker pool.
*/
function parsePatchFiles(data, cacheKeyPrefix, throwOnError = false) {
	const patches = [];
	const rawPatches = hasCommitMetadataBoundary(data) ? data.split(COMMIT_METADATA_SPLIT) : [data];
	for (const patch of rawPatches) try {
		patches.push(processPatch(patch, cacheKeyPrefix != null ? `${cacheKeyPrefix}-${patches.length}` : void 0, throwOnError));
	} catch (error) {
		if (throwOnError) throw error;
		else console.error(error);
	}
	return patches;
}
function hasCommitMetadataBoundary(data) {
	return data.startsWith("From ") || data.includes("\nFrom ");
}
function splitFileContents(contents) {
	const lines = splitWithNewlines(contents);
	for (let index = 0; index < lines.length; index++) lines[index] = detachString(lines[index]);
	return lines;
}
function splitWithNewlines(contents) {
	if (contents.length === 0) return [""];
	const lines = [];
	let startIndex = 0;
	for (;;) {
		const newlineIndex = contents.indexOf("\n", startIndex);
		if (newlineIndex === -1) break;
		lines.push(contents.slice(startIndex, newlineIndex + 1));
		startIndex = newlineIndex + 1;
	}
	if (startIndex < contents.length) lines.push(contents.slice(startIndex));
	return lines;
}
function splitGitDiffFiles(contents) {
	return splitAtLinePrefix(contents, "diff --git");
}
function splitUnifiedDiffFiles(contents) {
	if (contents.length === 0) return [""];
	const parts = [];
	let partStartIndex = 0;
	let lineStartIndex = 0;
	let remainingDeletionLines = 0;
	let remainingAdditionLines = 0;
	let hasOpenedUnifiedFile = false;
	while (lineStartIndex < contents.length) {
		const nextLineStartIndex = getNextLineStartIndex(contents, lineStartIndex);
		if (remainingDeletionLines <= 0 && remainingAdditionLines <= 0) {
			if (isUnifiedDiffFileHeaderAt(contents, lineStartIndex)) {
				if (lineStartIndex > partStartIndex) parts.push(contents.slice(partStartIndex, lineStartIndex));
				partStartIndex = lineStartIndex;
				hasOpenedUnifiedFile = true;
				lineStartIndex = getNextLineStartIndex(contents, nextLineStartIndex);
				continue;
			}
			if (hasOpenedUnifiedFile && contents.startsWith("@@ -", lineStartIndex)) {
				const fileHeader = parseHunkHeader(contents.slice(lineStartIndex, nextLineStartIndex));
				if (fileHeader != null) {
					remainingDeletionLines = fileHeader.deletionCount;
					remainingAdditionLines = fileHeader.additionCount;
				}
			}
			lineStartIndex = nextLineStartIndex;
			continue;
		}
		const firstChar = contents[lineStartIndex];
		if (firstChar === "\\") {
			lineStartIndex = nextLineStartIndex;
			continue;
		}
		if (firstChar === " ") {
			remainingDeletionLines = Math.max(remainingDeletionLines - 1, 0);
			remainingAdditionLines = Math.max(remainingAdditionLines - 1, 0);
		} else if (firstChar === "-") remainingDeletionLines = Math.max(remainingDeletionLines - 1, 0);
		else if (firstChar === "+") remainingAdditionLines = Math.max(remainingAdditionLines - 1, 0);
		lineStartIndex = nextLineStartIndex;
	}
	parts.push(contents.slice(partStartIndex));
	return parts;
}
function startsWithUnifiedDiffFileHeader(contents) {
	return isUnifiedDiffFileHeaderAt(contents, 0);
}
function isUnifiedDiffFileHeaderAt(contents, lineStartIndex) {
	const nextLineStartIndex = getNextLineStartIndex(contents, lineStartIndex);
	return isUnifiedDiffHeaderLineAt(contents, lineStartIndex, "---") && isUnifiedDiffHeaderLineAt(contents, nextLineStartIndex, "+++");
}
function isUnifiedDiffHeaderLineAt(contents, lineStartIndex, prefix) {
	if (!contents.startsWith(prefix, lineStartIndex)) return false;
	const separator = contents[lineStartIndex + prefix.length];
	if (separator !== " " && separator !== "	") return false;
	for (let index = lineStartIndex + prefix.length + 1; index < contents.length; index++) {
		const char = contents[index];
		if (char === "\n" || char === "\r") break;
		if (char !== " " && char !== "	") return true;
	}
	return false;
}
function getNextLineStartIndex(contents, lineStartIndex) {
	const newlineIndex = contents.indexOf("\n", lineStartIndex);
	return newlineIndex === -1 ? contents.length : newlineIndex + 1;
}
function isHunkBodyLine(line) {
	const firstChar = line[0];
	return firstChar === "+" || firstChar === "-" || firstChar === " ";
}
function isFormatPatchVersionSeparator(line) {
	if (!line.startsWith("--")) return false;
	for (let index = 2; index < line.length; index++) {
		const char = line[index];
		if (char !== " " && char !== "	" && char !== "\n" && char !== "\r") return false;
	}
	return true;
}
function parseHunkHeader(line) {
	if (!line.startsWith("@@ -")) return;
	let index = 4;
	const deletionStartResult = readPositiveInteger(line, index);
	if (deletionStartResult == null) return;
	const deletionStart = deletionStartResult.value;
	index = deletionStartResult.endIndex;
	let deletionCount = 1;
	if (line[index] === ",") {
		const deletionCountResult = readPositiveInteger(line, index + 1);
		if (deletionCountResult == null) return;
		deletionCount = deletionCountResult.value;
		index = deletionCountResult.endIndex;
	}
	if (line[index] !== " " || line[index + 1] !== "+") return;
	index += 2;
	const additionStartResult = readPositiveInteger(line, index);
	if (additionStartResult == null) return;
	const additionStart = additionStartResult.value;
	index = additionStartResult.endIndex;
	let additionCount = 1;
	if (line[index] === ",") {
		const additionCountResult = readPositiveInteger(line, index + 1);
		if (additionCountResult == null) return;
		additionCount = additionCountResult.value;
		index = additionCountResult.endIndex;
	}
	if (line[index] !== " " || line[index + 1] !== "@" || line[index + 2] !== "@") return;
	let hunkContext;
	const contextStartIndex = index + 3;
	if (line[contextStartIndex] === " ") hunkContext = trimLineEnd(line.slice(contextStartIndex + 1));
	return {
		additionCount,
		additionStart,
		deletionCount,
		deletionStart,
		hunkContext
	};
}
function readPositiveInteger(value, startIndex) {
	let index = startIndex;
	let parsedValue = 0;
	for (; index < value.length; index++) {
		const digit = value.charCodeAt(index) - 48;
		if (digit < 0 || digit > 9) break;
		parsedValue = parsedValue * 10 + digit;
	}
	if (index === startIndex) return;
	return {
		value: parsedValue,
		endIndex: index
	};
}
function trimLineEnd(value) {
	if (value.endsWith("\r\n")) return value.slice(0, -2);
	if (value.endsWith("\n")) return value.slice(0, -1);
	return value;
}
function isGitDiffPatch(data) {
	return data.startsWith("diff --git") || data.includes("\ndiff --git");
}
function splitAtLinePrefix(contents, prefix) {
	if (contents.length === 0) return [""];
	const newlinePrefix = `\n${prefix}`;
	const firstBoundaryIndex = contents.startsWith(prefix) ? 0 : findLinePrefixIndex(contents, newlinePrefix, 0);
	if (firstBoundaryIndex === -1) return [contents];
	const parts = [];
	if (firstBoundaryIndex > 0) parts.push(contents.slice(0, firstBoundaryIndex));
	let startIndex = firstBoundaryIndex;
	for (;;) {
		const nextBoundaryIndex = findLinePrefixIndex(contents, newlinePrefix, startIndex + 1);
		if (nextBoundaryIndex === -1) break;
		parts.push(contents.slice(startIndex, nextBoundaryIndex));
		startIndex = nextBoundaryIndex;
	}
	parts.push(contents.slice(startIndex));
	return parts;
}
function findLinePrefixIndex(contents, newlinePrefix, fromIndex) {
	const index = contents.indexOf(newlinePrefix, fromIndex);
	return index === -1 ? -1 : index + 1;
}
function maybeDetachOptionalString(value) {
	return value == null ? value : detachString(value);
}
function parseRawLineType(firstChar) {
	return firstChar === " " ? "context" : firstChar === "\\" ? "metadata" : firstChar === "+" ? "addition" : "deletion";
}
function getParsedLineContent(rawLine) {
	const processedLine = rawLine.slice(1);
	return detachString(processedLine === "" ? "\n" : processedLine);
}
function createContentGroup(type, deletionLineIndex, additionLineIndex) {
	if (type === "change") return {
		type: "change",
		additions: 0,
		deletions: 0,
		additionLineIndex,
		deletionLineIndex
	};
	return {
		type: "context",
		lines: 0,
		additionLineIndex,
		deletionLineIndex
	};
}
//#endregion
export { parsePatchFiles, processFile, processPatch };

//# sourceMappingURL=parsePatchFiles.js.map
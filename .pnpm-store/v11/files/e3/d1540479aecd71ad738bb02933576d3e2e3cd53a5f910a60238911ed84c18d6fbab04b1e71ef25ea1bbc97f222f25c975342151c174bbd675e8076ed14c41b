import { fileExtensions, fileNames, folderNames } from "./icon-map.mjs";
//#region src/MaterialFileTypeIcon/utils.ts
function getFileExtension(fileName) {
	return fileName.slice(Math.max(0, fileName.lastIndexOf(".") + 1));
}
function getFileSuffix(fileName) {
	return fileName.slice(fileName.indexOf(".") + 1);
}
function filenameFromPath(path) {
	return path.split("/").at(-1) ?? path;
}
function getIconNameForFileName(fileName) {
	return fileNames[fileName] ?? fileNames[fileName.toLowerCase()] ?? fileExtensions[getFileSuffix(fileName)] ?? fileExtensions[getFileExtension(fileName)] ?? (fileName.endsWith(".html") ? "html" : null) ?? (fileName.endsWith(".ts") ? "typescript" : null) ?? (fileName.endsWith(".js") ? "javascript" : null) ?? "file";
}
function getIconNameForDirectoryName(dirName) {
	return folderNames[dirName] ?? folderNames[dirName.toLowerCase()] ?? "folder";
}
function getIconForFilePath(path) {
	return getIconNameForFileName(filenameFromPath(path));
}
function getIconForDirectoryPath(path) {
	return getIconNameForDirectoryName(filenameFromPath(path));
}
function getIconUrlByName(iconName, iconsUrl, open) {
	return `${iconsUrl}/${iconName.toString()}${open ? "-open" : ""}.svg`;
}
function getIconUrlForFilePath({ path, iconsUrl, fallbackUnknownType }) {
	const iconName = getIconForFilePath(path);
	if (fallbackUnknownType && iconName === "file") return "";
	return getIconUrlByName(iconName, iconsUrl);
}
function getIconUrlForDirectoryPath({ path, iconsUrl, open, fallbackUnknownType }) {
	const iconName = getIconForDirectoryPath(path);
	if (fallbackUnknownType && iconName === "folder") return "";
	return getIconUrlByName(iconName, iconsUrl, open);
}
//#endregion
export { filenameFromPath, getIconForDirectoryPath, getIconForFilePath, getIconNameForDirectoryName, getIconNameForFileName, getIconUrlByName, getIconUrlForDirectoryPath, getIconUrlForFilePath };

//# sourceMappingURL=utils.mjs.map
import { FileRenderer } from "../renderers/FileRenderer.js";
import { wrapThemeCSS } from "../utils/cssWrappers.js";
import { createStyleElement, createThemeStyleElement } from "../utils/createStyleElement.js";
import { renderHTML } from "./renderHTML.js";
//#region src/ssr/preloadFile.ts
async function preloadFile({ file, options, annotations }) {
	const fileRenderer = new FileRenderer({
		...options,
		headerRenderMode: options?.renderCustomHeader != null ? "custom" : "default"
	});
	if (annotations !== void 0 && annotations.length > 0) fileRenderer.setLineAnnotations(annotations);
	const fileResult = await fileRenderer.asyncRender(file);
	const children = [createStyleElement(fileResult.css, true)];
	children.push(createThemeStyleElement(wrapThemeCSS(fileResult.themeStyles, fileResult.baseThemeType ?? options?.themeType ?? "system")));
	if (options?.unsafeCSS != null) children.push(createStyleElement(options.unsafeCSS));
	if (fileResult.headerAST != null) children.push(fileResult.headerAST);
	const code = fileRenderer.renderFullAST(fileResult);
	code.properties["data-dehydrated"] = "";
	children.push(code);
	return {
		file,
		options,
		annotations,
		prerenderedHTML: renderHTML(children)
	};
}
//#endregion
export { preloadFile };

//# sourceMappingURL=preloadFile.js.map
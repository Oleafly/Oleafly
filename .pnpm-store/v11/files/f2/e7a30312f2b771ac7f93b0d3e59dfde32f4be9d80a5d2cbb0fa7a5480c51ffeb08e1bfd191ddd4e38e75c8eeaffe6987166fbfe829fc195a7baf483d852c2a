import { getTokenStyleObject, stringifyTokenStyle } from "shiki";
//#region src/utils/createSpanNodeFromToken.ts
function createSpanFromToken(token) {
	const element = document.createElement("span");
	element.style = stringifyTokenStyle(token.htmlStyle ?? getTokenStyleObject(token));
	element.textContent = token.content;
	return element;
}
//#endregion
export { createSpanFromToken };

//# sourceMappingURL=createSpanNodeFromToken.js.map
//#region src/FluentEmoji/utils.ts
function emojiToUnicode(emoji) {
	return [...emoji].map((char) => char?.codePointAt(0)?.toString(16)).join("-");
}
function emojiAnimPkg(emoji) {
	const mainPart = emojiToUnicode(emoji).split("-")[0];
	if (mainPart < "1f469") return "@lobehub/fluent-emoji-anim-1";
	else if (mainPart >= "1f469" && mainPart < "1f620") return "@lobehub/fluent-emoji-anim-2";
	else if (mainPart >= "1f620" && mainPart < "1f9a0") return "@lobehub/fluent-emoji-anim-3";
	else return "@lobehub/fluent-emoji-anim-4";
}
const genEmojiUrl = (emoji, type) => {
	const ext = ["anim", "3d"].includes(type) ? "webp" : "svg";
	switch (type) {
		case "raw": return null;
		case "anim": return {
			path: `assets/${emojiToUnicode(emoji)}.${ext}`,
			pkg: emojiAnimPkg(emoji),
			version: "latest"
		};
		case "3d": return {
			path: `assets/${emojiToUnicode(emoji)}.${ext}`,
			pkg: "@lobehub/fluent-emoji-3d",
			version: "latest"
		};
		case "flat": return {
			path: `assets/${emojiToUnicode(emoji)}.${ext}`,
			pkg: "@lobehub/fluent-emoji-flat",
			version: "latest"
		};
		case "modern": return {
			path: `assets/${emojiToUnicode(emoji)}.${ext}`,
			pkg: "@lobehub/fluent-emoji-modern",
			version: "latest"
		};
		case "mono": return {
			path: `assets/${emojiToUnicode(emoji)}.${ext}`,
			pkg: "@lobehub/fluent-emoji-mono",
			version: "latest"
		};
	}
};
//#endregion
export { emojiAnimPkg, emojiToUnicode, genEmojiUrl };

//# sourceMappingURL=utils.mjs.map
import { hoverWouldEraseText, isFullyTransparent } from "./color.js";
//#region src/modules/normalizeThemeColors.ts
/**
* normalizeThemeColors is the public front door for reading the colors a
* Shiki/VS Code theme defines. It returns a SAME-SHAPE theme (same top-level
* fields, same `colors` key vocabulary) whose `colors` map has the standard
* fallback chains applied and a few universal repairs done, so every consumer
* reads one resolved set of workbench keys instead of re-deriving the chains.
*
* It does NOT touch syntax/editor token colors or the base fg/bg/type — those
* are owned by Shiki's normalizeTheme upstream, and this function assumes a
* theme that has already passed through it. Do not confuse the two:
* `normalizeTheme` (Shiki) normalizes the whole theme; `normalizeThemeColors`
* (here) only resolves the workbench `colors` map.
*
* What it fills (mechanical fallback, no opinion):
*   - surfaces: editor/sideBar background+foreground, input.background,
*     sideBarSectionHeader.foreground, list.activeSelectionForeground — via the
*     editor→base and sideBar→editor→base precedence.
*   - git status: gitDecoration.{added,modified,deleted}ResourceForeground via
*     the gitDecoration → terminal.ansi* → editorGutter.* chain.
*   - focus ring: list.focusOutline set to the first NON-transparent of
*     [list.focusOutline, focusBorder].
*
* What it repairs (universal correctness, the ceiling of what it adds):
*   - drops list.hoverBackground when it exactly equals the sidebar surface or
*     would land on top of the row text (hoverWouldEraseText) — a hover that
*     erases legibility is broken for any consumer.
*
* What it deliberately leaves alone (consumer presentation opinion):
*   - the selection lookup (list.activeSelectionBackground vs the same-surface
*     swap to list.focusBackground) stays a consumer recipe; the raw keys pass
*     through untouched so a consumer can apply its own choice.
*
* The result is pure, frozen, and WeakMap-memoized per input theme, and the
* function is idempotent: normalizeThemeColors(normalizeThemeColors(t)) yields
* an equal result. That idempotency is what lets it run lazily at read time
* (the default) OR be pre-applied at load time and seeded — without a consumer
* ever getting a different answer.
*
* The fallback chains are small and used only here, so they are inlined rather
* than split into a separate resolver module.
*/
const cache = /* @__PURE__ */ new WeakMap();
function normalizeThemeColors(theme) {
	const cached = cache.get(theme);
	if (cached != null) return cached;
	const originalColors = theme.colors ?? {};
	const colors = { ...originalColors };
	const editorBackground = originalColors["editor.background"] ?? theme.bg;
	const editorForeground = originalColors["editor.foreground"] ?? theme.fg;
	const sidebarBackground = originalColors["sideBar.background"] ?? editorBackground;
	const sidebarForeground = originalColors["sideBar.foreground"] ?? editorForeground;
	fill(colors, "editor.background", editorBackground);
	fill(colors, "editor.foreground", editorForeground);
	fill(colors, "sideBar.background", sidebarBackground);
	fill(colors, "sideBar.foreground", sidebarForeground);
	fill(colors, "input.background", originalColors["input.background"] ?? sidebarBackground);
	fill(colors, "sideBarSectionHeader.foreground", originalColors["sideBarSectionHeader.foreground"] ?? sidebarForeground);
	fill(colors, "list.activeSelectionForeground", originalColors["list.activeSelectionForeground"] ?? sidebarForeground);
	fill(colors, "gitDecoration.addedResourceForeground", firstColor(originalColors["gitDecoration.addedResourceForeground"], originalColors["terminal.ansiGreen"], originalColors["editorGutter.addedBackground"]));
	fill(colors, "gitDecoration.modifiedResourceForeground", firstColor(originalColors["gitDecoration.modifiedResourceForeground"], originalColors["terminal.ansiBlue"], originalColors["editorGutter.modifiedBackground"]));
	fill(colors, "gitDecoration.deletedResourceForeground", firstColor(originalColors["gitDecoration.deletedResourceForeground"], originalColors["terminal.ansiRed"], originalColors["editorGutter.deletedBackground"]));
	const focusRing = (isFullyTransparent(originalColors["list.focusOutline"]) ? void 0 : originalColors["list.focusOutline"]) ?? (isFullyTransparent(originalColors["focusBorder"]) ? void 0 : originalColors["focusBorder"]);
	if (focusRing != null) colors["list.focusOutline"] = focusRing;
	else delete colors["list.focusOutline"];
	const hover = originalColors["list.hoverBackground"];
	if (hover != null && (matchesSurface(hover, sidebarBackground) || hoverWouldEraseText(hover, sidebarBackground, sidebarForeground))) delete colors["list.hoverBackground"];
	const result = Object.freeze({
		...theme,
		colors: Object.freeze(colors)
	});
	cache.set(theme, result);
	return result;
}
function fill(colors, key, value) {
	if (value != null && value !== "") colors[key] = value;
}
function firstColor(...candidates) {
	for (const candidate of candidates) if (candidate != null && candidate !== "") return candidate;
}
function matchesSurface(color, surface) {
	return surface != null && color.toLowerCase() === surface.toLowerCase();
}
//#endregion
export { normalizeThemeColors };

//# sourceMappingURL=normalizeThemeColors.js.map
//#region src/managers/ScrollSyncManager.ts
var ScrollSyncManager = class {
	isDeletionsScrolling = false;
	isAdditionsScrolling = false;
	timeoutId = -1;
	codeDeletions;
	codeAdditions;
	enabled = false;
	cleanUp() {
		if (!this.enabled) return;
		this.codeDeletions?.removeEventListener("scroll", this.handleDeletionsScroll);
		this.codeAdditions?.removeEventListener("scroll", this.handleAdditionsScroll);
		clearTimeout(this.timeoutId);
		this.codeDeletions = void 0;
		this.codeAdditions = void 0;
		this.enabled = false;
	}
	setup(pre, codeDeletions, codeAdditions) {
		if (codeDeletions == null || codeAdditions == null) for (const element of pre.children ?? []) {
			if (!(element instanceof HTMLElement)) continue;
			if ("deletions" in element.dataset) codeDeletions = element;
			else if ("additions" in element.dataset) codeAdditions = element;
		}
		if (codeAdditions == null || codeDeletions == null) {
			this.cleanUp();
			return;
		}
		if (this.codeDeletions !== codeDeletions) {
			this.codeDeletions?.removeEventListener("scroll", this.handleDeletionsScroll);
			this.codeDeletions = codeDeletions;
			codeDeletions.addEventListener("scroll", this.handleDeletionsScroll, { passive: true });
		}
		if (this.codeAdditions !== codeAdditions) {
			this.codeAdditions?.removeEventListener("scroll", this.handleAdditionsScroll);
			this.codeAdditions = codeAdditions;
			codeAdditions.addEventListener("scroll", this.handleAdditionsScroll, { passive: true });
		}
		this.enabled = true;
	}
	handleDeletionsScroll = () => {
		if (this.isAdditionsScrolling) return;
		this.isDeletionsScrolling = true;
		clearTimeout(this.timeoutId);
		this.timeoutId = setTimeout(() => {
			this.isDeletionsScrolling = false;
		}, 300);
		this.codeAdditions?.scrollTo({ left: this.codeDeletions?.scrollLeft });
	};
	handleAdditionsScroll = () => {
		if (this.isDeletionsScrolling) return;
		this.isAdditionsScrolling = true;
		clearTimeout(this.timeoutId);
		this.timeoutId = setTimeout(() => {
			this.isAdditionsScrolling = false;
		}, 300);
		this.codeDeletions?.scrollTo({ left: this.codeAdditions?.scrollLeft });
	};
};
//#endregion
export { ScrollSyncManager };

//# sourceMappingURL=ScrollSyncManager.js.map
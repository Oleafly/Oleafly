//#region src/managers/UniversalRenderingManager.ts
const callbacks = /* @__PURE__ */ new Set();
let frameId = null;
function queueRender(callback) {
	callbacks.add(callback);
	frameId ??= requestAnimationFrame(render);
}
function dequeueRender(callback) {
	callbacks.delete(callback);
	if (callbacks.size === 0 && frameId != null) {
		cancelAnimationFrame(frameId);
		frameId = null;
	}
}
function render(time) {
	const toIterate = new Set(callbacks);
	callbacks.clear();
	for (const callback of toIterate) try {
		callback(time);
	} catch (error) {
		console.error(error);
	}
	if (callbacks.size > 0) frameId = requestAnimationFrame(render);
	else frameId = null;
}
//#endregion
export { dequeueRender, queueRender };

//# sourceMappingURL=UniversalRenderingManager.js.map
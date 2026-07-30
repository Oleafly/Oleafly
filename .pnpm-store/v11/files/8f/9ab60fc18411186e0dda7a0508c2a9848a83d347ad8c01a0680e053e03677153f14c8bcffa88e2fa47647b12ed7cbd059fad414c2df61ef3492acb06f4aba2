"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
//#region src/hooks/useCopied.ts
const useCopied = () => {
	const [copied, setCopy] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => {
			setCopy(false);
		}, 2e3);
		return () => {
			clearTimeout(timer);
		};
	}, [copied]);
	const setCopied = useCallback(() => setCopy(true), []);
	return useMemo(() => ({
		copied,
		setCopied
	}), [copied]);
};
//#endregion
export { useCopied };

//# sourceMappingURL=useCopied.mjs.map
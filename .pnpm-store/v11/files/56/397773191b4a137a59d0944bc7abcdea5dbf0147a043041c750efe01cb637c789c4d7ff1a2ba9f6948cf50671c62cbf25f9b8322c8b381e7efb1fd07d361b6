import { useEffect, useState } from "react";
//#region src/hooks/useIsClient.ts
const useIsClient = () => {
	const [isClient, setIsClient] = useState(typeof document !== "undefined");
	useEffect(() => {
		if (isClient) return;
		setIsClient(true);
	}, []);
	return isClient;
};
//#endregion
export { useIsClient };

//# sourceMappingURL=useIsClient.mjs.map
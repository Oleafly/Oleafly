import urlJoin from "url-join";
//#region src/utils/genCdnUrl.ts
const UNPKG_API = "https://unpkg.com";
const ALIYUN_API = "https://registry.npmmirror.com";
const genCdnUrl = ({ pkg, version = "latest", path, proxy }) => {
	switch (proxy) {
		case "unpkg": return urlJoin(UNPKG_API, `${pkg}@${version}`, path);
		default: return urlJoin(ALIYUN_API, pkg, version, "files", path);
	}
};
//#endregion
export { ALIYUN_API, UNPKG_API, genCdnUrl };

//# sourceMappingURL=genCdnUrl.mjs.map
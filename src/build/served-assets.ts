import type { Plugin } from "vite";

export type AssetBody = string | Uint8Array;

export interface ServedAssets {
  readonly name: string;
  readonly files: () => ReadonlyMap<string, () => AssetBody>;
  readonly contentType: (fileName: string) => string;
}

export function servedAssets({ name, files, contentType }: ServedAssets): Plugin {
  return {
    name,
    configureServer(server) {
      const base = server.config.base;
      const served = files();
      const cache = new Map<string, AssetBody>();
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split("?")[0] ?? "";
        const fileName = url.startsWith(base) ? url.slice(base.length) : "";
        const read = served.get(fileName);
        if (!read) return next();
        const body = cache.get(fileName) ?? read();
        cache.set(fileName, body);
        response.setHeader("Content-Type", contentType(fileName));
        response.end(request.method === "HEAD" ? undefined : body);
      });
    },
    generateBundle() {
      for (const [fileName, read] of files()) this.emitFile({ type: "asset", fileName, source: read() });
    },
  };
}

import { sameServer } from "./links/app-link";

export const OLEAFLY_SERVER = { name: "Oleafly", url: "https://collab.oleafly.com" } as const;

export function hasOleaflyServer(servers: readonly { url: string }[]): boolean {
  return servers.some((entry) => sameServer(entry.url, OLEAFLY_SERVER.url));
}

import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "@/lib/local-storage";

const APP_HOSTS: ReadonlySet<string> = new Set(["tauri.localhost", "asset.localhost"]);

function pageAddress(): string {
  return typeof window === "undefined" ? "tauri://localhost/" : window.location.href;
}

export function remoteImageHost(src: string, base: string = pageAddress()): string | null {
  const value = src.trim();
  if (value === "" || /^(?:data|blob):/iu.test(value)) return null;
  let url: URL;
  let page: URL;
  try {
    page = new URL(base);
    url = new URL(value, page);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === page.origin || APP_HOSTS.has(url.hostname)) return null;
  return url.host;
}

export interface RemoteImage {
  url: string;
  host: string;
}

export const REMOTE_IMAGE_HOSTS_KEY = "oleafly.notes.remoteImageHosts";

const allowed = new Set<string>();
const listeners = new Set<() => void>();
let trusted: Set<string> | null = null;
let trustedList: readonly string[] | null = null;

function trustedHosts(): Set<string> {
  if (!trusted) {
    const saved = readJson<unknown>(REMOTE_IMAGE_HOSTS_KEY, []);
    trusted = new Set(Array.isArray(saved) ? saved.filter((host): host is string => typeof host === "string") : []);
  }
  return trusted;
}

export function trustedRemoteImageHosts(): readonly string[] {
  trustedList ??= [...trustedHosts()];
  return trustedList;
}

export function useTrustedRemoteImageHosts(): readonly string[] {
  return useSyncExternalStore(subscribeRemoteImages, trustedRemoteImageHosts);
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    if (listeners.has(listener)) listener();
  }
}

export function remoteImage(src: string): RemoteImage | null {
  const host = remoteImageHost(src);
  return host ? { url: src.trim(), host } : null;
}

export function remoteImageAllowed(url: string): boolean {
  if (allowed.has(url)) return true;
  const host = remoteImageHost(url);
  return host !== null && trustedHosts().has(host);
}

export function heldRemoteImage(src: string): RemoteImage | null {
  const remote = remoteImage(src);
  return remote && !remoteImageAllowed(remote.url) ? remote : null;
}

export function allowRemoteImages(urls: readonly string[]): void {
  const fresh = urls.filter((url) => !allowed.has(url));
  if (fresh.length === 0) return;
  for (const url of fresh) allowed.add(url);
  notify();
}

export function allowRemoteImage(url: string): void {
  allowRemoteImages([url]);
}

function saveTrustedHosts(hosts: Set<string>): void {
  trustedList = null;
  writeJson(REMOTE_IMAGE_HOSTS_KEY, [...hosts]);
  notify();
}

export function trustRemoteImageHost(host: string): void {
  const hosts = trustedHosts();
  if (hosts.has(host)) return;
  hosts.add(host);
  saveTrustedHosts(hosts);
}

export function untrustRemoteImageHost(host: string): void {
  const hosts = trustedHosts();
  if (!hosts.delete(host)) return;
  saveTrustedHosts(hosts);
}

export function subscribeRemoteImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetRemoteImagesForTest(): void {
  allowed.clear();
  trusted = null;
  trustedList = null;
}

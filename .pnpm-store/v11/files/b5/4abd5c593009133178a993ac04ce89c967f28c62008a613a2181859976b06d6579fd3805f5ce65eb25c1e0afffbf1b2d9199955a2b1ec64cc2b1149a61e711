import { Resource } from '@tauri-apps/api/core';
/** Options used when checking for updates */
interface CheckOptions {
    /**
     * Request headers
     */
    headers?: HeadersInit;
    /**
     * Timeout in milliseconds
     */
    timeout?: number;
    /**
     * A proxy url to be used when checking and downloading updates.
     */
    proxy?: string;
    /**
     * Target identifier for the running application. This is sent to the backend.
     */
    target?: string;
    /**
     * Allow downgrades to previous versions by not checking if the current version is greater than the available version.
     */
    allowDowngrades?: boolean;
}
/** Options used when downloading an update */
interface DownloadOptions {
    /**
     * Request headers
     */
    headers?: HeadersInit;
    /**
     * Timeout in milliseconds
     */
    timeout?: number;
}
interface UpdateMetadata {
    rid: number;
    currentVersion: string;
    version: string;
    date?: string;
    body?: string;
    rawJson: Record<string, unknown>;
}
/** Updater download event */
type DownloadEvent = {
    event: 'Started';
    data: {
        contentLength?: number;
    };
} | {
    event: 'Progress';
    data: {
        chunkLength: number;
    };
} | {
    event: 'Finished';
};
declare class Update extends Resource {
    /** @deprecated This is always true, check if the return value is `null` instead when using {@linkcode check} */
    available: boolean;
    currentVersion: string;
    version: string;
    date?: string;
    body?: string;
    rawJson: Record<string, unknown>;
    private downloadedBytes?;
    constructor(metadata: UpdateMetadata);
    /** Download the updater package */
    download(onEvent?: (progress: DownloadEvent) => void, options?: DownloadOptions): Promise<void>;
    /** Install downloaded updater package */
    install(): Promise<void>;
    /** Downloads the updater package and installs it */
    downloadAndInstall(onEvent?: (progress: DownloadEvent) => void, options?: DownloadOptions): Promise<void>;
    close(): Promise<void>;
}
/** Check for updates, resolves to `null` if no updates are available */
declare function check(options?: CheckOptions): Promise<Update | null>;
export type { CheckOptions, DownloadOptions, DownloadEvent };
export { check, Update };

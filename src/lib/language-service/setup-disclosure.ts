import languageServerManifest from "../../../scripts/language-servers/manifest.json";
import type { LanguageServiceKind } from "./transport";

export interface LanguageServiceSetupDisclosure {
  kind: LanguageServiceKind;
  displayName: string;
  version: string;
  purpose: string;
  license: {
    spdx: string;
    url: string;
  };
  sourceUrl: string;
  destination: string;
  checksumVerification: true;
}

const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (
  value: unknown,
  field: string,
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Language-server setup manifest field ${field} is invalid`,
    );
  }
  return value;
};

const httpsUrl = (value: unknown, field: string): string => {
  const url = nonEmptyString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Language-server setup manifest field ${field} is not a URL`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Language-server setup manifest field ${field} must use HTTPS`,
    );
  }
  return url;
};

const sha256 = (value: unknown, field: string): void => {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value)
  ) {
    throw new Error(
      `Language-server setup manifest field ${field} is not a SHA-256 digest`,
    );
  }
};

const positiveInteger = (value: unknown, field: string): void => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(
      `Language-server setup manifest field ${field} must be a positive integer`,
    );
  }
};

/**
 * Parses the consent disclosure from the same packaged manifest used by the
 * installer. Invalid or incomplete policy metadata fails closed so the UI
 * cannot offer a download without first describing the pinned artifact.
 */
export function parseLanguageServiceSetupDisclosure(
  manifest: unknown,
  kind: LanguageServiceKind,
): LanguageServiceSetupDisclosure {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.supportedTargets) ||
    manifest.supportedTargets.length === 0 ||
    !manifest.supportedTargets.every(
      (target) =>
        typeof target === "string" && target.length > 0,
    ) ||
    !isRecord(manifest.appDataInstallation) ||
    !isRecord(manifest.servers)
  ) {
    throw new Error(
      "Language-server setup manifest schema is invalid",
    );
  }

  const server = manifest.servers[kind];
  if (
    !isRecord(server) ||
    !isRecord(server.license) ||
    !isRecord(server.distribution) ||
    !isRecord(server.targets)
  ) {
    throw new Error(
      `Language-server setup metadata for ${kind} is missing`,
    );
  }
  if (
    server.distribution.defaultPolicy !== "app-data-download" ||
    server.distribution.runtimeLocation !== "app-data" ||
    server.distribution.requiresUserConsent !== true ||
    server.distribution.retryRequiresUserAction !== true ||
    server.tauriExternalBin !== null
  ) {
    throw new Error(
      `Language-server setup policy for ${kind} does not permit a consent download`,
    );
  }

  const displayName = nonEmptyString(
    server.displayName,
    `${kind}.displayName`,
  );
  const purpose = nonEmptyString(
    server.setupPurpose,
    `${kind}.setupPurpose`,
  );
  const version = nonEmptyString(
    server.version,
    `${kind}.version`,
  );
  const binaryBaseName = nonEmptyString(
    server.binaryBaseName,
    `${kind}.binaryBaseName`,
  );
  const relativeDirectory = nonEmptyString(
    manifest.appDataInstallation.relativeDirectory,
    "appDataInstallation.relativeDirectory",
  );
  const spdx = nonEmptyString(
    server.license.spdx,
    `${kind}.license.spdx`,
  );
  const licenseUrl = httpsUrl(
    server.license.licenseUrl,
    `${kind}.license.licenseUrl`,
  );
  const sourceUrl = httpsUrl(
    server.license.sourceUrl,
    `${kind}.license.sourceUrl`,
  );
  const tag = nonEmptyString(server.tag, `${kind}.tag`);
  if (!sourceUrl.endsWith(`/tree/${tag}`)) {
    throw new Error(
      `Language-server setup source URL for ${kind} is not pinned to ${tag}`,
    );
  }

  for (const target of manifest.supportedTargets) {
    const artifact = server.targets[target];
    if (!isRecord(artifact)) {
      throw new Error(
        `Language-server setup artifact for ${kind}/${target} is missing`,
      );
    }
    sha256(
      artifact.archiveSha256,
      `${kind}.targets.${target}.archiveSha256`,
    );
    sha256(
      artifact.binarySha256,
      `${kind}.targets.${target}.binarySha256`,
    );
    positiveInteger(
      artifact.archiveSize,
      `${kind}.targets.${target}.archiveSize`,
    );
    positiveInteger(
      artifact.binarySize,
      `${kind}.targets.${target}.binarySize`,
    );
  }

  return {
    kind,
    displayName,
    version,
    purpose,
    license: { spdx, url: licenseUrl },
    sourceUrl,
    destination:
      `App-local data / ${relativeDirectory}/${kind}/${version}` +
      `/<platform>/${binaryBaseName}[.exe]`,
    checksumVerification: true,
  };
}

export function getLanguageServiceSetupDisclosure(
  kind: LanguageServiceKind,
): LanguageServiceSetupDisclosure {
  return parseLanguageServiceSetupDisclosure(
    languageServerManifest,
    kind,
  );
}

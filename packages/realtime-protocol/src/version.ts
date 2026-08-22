export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const AUTHORING_DOC_SCHEMA_VERSION = 1 as const;
export const CANONICAL_MANIFEST_SCHEMA_VERSION = 1 as const;

export const SUPPORTED_REALTIME_PROTOCOL_VERSIONS = [
  REALTIME_PROTOCOL_VERSION,
] as const;

export type RealtimeProtocolVersion =
  (typeof SUPPORTED_REALTIME_PROTOCOL_VERSIONS)[number];

export function negotiateRealtimeProtocolVersion(
  peerVersions: readonly number[],
): RealtimeProtocolVersion | null {
  return negotiateHighestCommonVersion(
    SUPPORTED_REALTIME_PROTOCOL_VERSIONS,
    peerVersions,
  ) as RealtimeProtocolVersion | null;
}

export function negotiateHighestCommonVersion(
  localVersions: readonly number[],
  peerVersions: readonly number[],
): number | null {
  const common = localVersions.filter((version) => peerVersions.includes(version));
  return common.length === 0
    ? null
    : common.reduce((highest, version) => Math.max(highest, version));
}

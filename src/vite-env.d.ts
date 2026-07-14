/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional override for the GitHub OAuth App Client ID (for forks/distributors).
  readonly VITE_GITHUB_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import type { BrowserSearchEngineId } from "@/store/settings";

export function SearchEngineIcon({
  engine,
}: {
  engine: BrowserSearchEngineId;
}) {
  if (engine === "google") {
    return (
      <svg
        aria-hidden
        className="size-4 shrink-0"
        data-testid="search-engine-icon-google"
        viewBox="0 0 48 48"
      >
        <title>Google</title>
        <path
          fill="#FFC107"
          d="M43.61 20H24v8h11.3C33.65 32.66 29.22 36 24 36c-6.63 0-12-5.37-12-12s5.37-12 12-12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.39-4Z"
        />
        <path
          fill="#FF3D00"
          d="m6.31 14.69 6.57 4.82C14.65 15.11 18.96 12 24 12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4c-7.68 0-14.34 4.34-17.69 10.69Z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.17 0 9.86-1.98 13.41-5.19l-6.19-5.24A11.93 11.93 0 0 1 24 36c-5.2 0-9.62-3.32-11.28-7.95L6.2 33.08C9.5 39.56 16.23 44 24 44Z"
        />
        <path
          fill="#1976D2"
          d="M43.61 20H24v8h11.3a12.05 12.05 0 0 1-4.08 5.57l6.19 5.24C36.97 39.2 44 34 44 24c0-1.34-.14-2.65-.39-4Z"
        />
      </svg>
    );
  }

  if (engine === "duckduckgo") {
    return (
      <svg
        aria-hidden
        className="size-4 shrink-0"
        data-testid="search-engine-icon-duckduckgo"
        viewBox="0 0 24 24"
      >
        <title>DuckDuckGo</title>
        <circle cx="12" cy="12" r="11" fill="#DE5833" />
        <path
          fill="#FFF"
          d="M7.1 10.2c0-3.2 2-5.6 4.8-5.6 2.6 0 4.7 2.1 4.7 4.8 0 3.2-2.2 5.7-5.4 5.7-2.5 0-4.1-1.9-4.1-4.9Z"
        />
        <circle cx="10.8" cy="8.1" r=".8" fill="#323232" />
        <path fill="#F6B63E" d="m14.5 9.3 4.1 1.2-4.2 1.8Z" />
        <path fill="#67A64B" d="m8.7 16 3.2 1.5-2.4 2.1-1.3-2.2Z" />
        <path fill="#67A64B" d="m12.1 17.5 3.2-1.5.5 1.4-1.3 2.2Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden
      className="size-4 shrink-0"
      data-testid="search-engine-icon-bing"
      viewBox="0 0 24 24"
    >
      <title>Bing</title>
      <path
        fill="#008373"
        d="M5.5 2v14.5l5.7 3.4 7.3-4.3v-5.4l-5.9-3.4 1.8 4.3 1.7 1v1.9l-4.9 2.9-3.1-1.8V3.6Z"
      />
    </svg>
  );
}

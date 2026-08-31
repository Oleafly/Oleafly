const BASE_APP_FONT_SIZE = 16;
export const ASSISTANT_MIN_WIDTH = 480;
const FILE_SIDEBAR_MIN_WIDTH = 250;
const RAIL_WIDTH_REM = 3;
const SIDEBAR_HANDLE_WIDTH_REM = 0.75;

function normalizedFontSize(appFontSize: number): number {
  return Number.isFinite(appFontSize) && appFontSize > 0
    ? appFontSize
    : BASE_APP_FONT_SIZE;
}

export function assistantMinimumWidth(appFontSize: number): number {
  const fontSize = normalizedFontSize(appFontSize);
  return Math.max(
    ASSISTANT_MIN_WIDTH,
    Math.ceil((ASSISTANT_MIN_WIDTH * fontSize) / BASE_APP_FONT_SIZE),
  );
}

export function sidebarPanelGroupWidth(
  panelAreaWidth: number,
  appFontSize: number,
): number {
  return Math.max(
    0,
    panelAreaWidth -
      (RAIL_WIDTH_REM + SIDEBAR_HANDLE_WIDTH_REM) * normalizedFontSize(appFontSize),
  );
}

export function sidebarMinimumPercent(
  panelGroupWidth: number,
  assistant: boolean,
  appFontSize: number,
): number {
  if (panelGroupWidth <= 0) return 15;
  const pixels = assistant
    ? assistantMinimumWidth(appFontSize)
    : FILE_SIDEBAR_MIN_WIDTH;
  return Math.min(65, (pixels / panelGroupWidth) * 100);
}

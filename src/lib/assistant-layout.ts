const BASE_APP_FONT_SIZE = 16;
export const ASSISTANT_MIN_WIDTH = 480;
const SIDEBAR_HANDLE_WIDTH_REM = 0.75;
const RAIL_SLOTS = 7;
const RAIL_BAR_PADDING_REM = 0.75;
const RAIL_ICON_REM = 1.75;
const RAIL_SLOT_SPACING_REM = 0.5;
const RAIL_DIVIDER_PX = 1;
const RAIL_SLACK_PX = 4;

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

export function fileSidebarWidth(appFontSize: number): number {
  const rem = normalizedFontSize(appFontSize);
  const extraSlots = RAIL_SLOTS - 1;
  const width = rem * (RAIL_BAR_PADDING_REM + RAIL_ICON_REM + extraSlots * (RAIL_SLOT_SPACING_REM + RAIL_ICON_REM));
  return Math.ceil(width + extraSlots * RAIL_DIVIDER_PX + RAIL_SLACK_PX);
}

export function sidebarPanelGroupWidth(
  panelAreaWidth: number,
  appFontSize: number,
): number {
  return Math.max(
    0,
    panelAreaWidth - SIDEBAR_HANDLE_WIDTH_REM * normalizedFontSize(appFontSize),
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
    : fileSidebarWidth(appFontSize);
  return Math.min(65, (pixels / panelGroupWidth) * 100);
}

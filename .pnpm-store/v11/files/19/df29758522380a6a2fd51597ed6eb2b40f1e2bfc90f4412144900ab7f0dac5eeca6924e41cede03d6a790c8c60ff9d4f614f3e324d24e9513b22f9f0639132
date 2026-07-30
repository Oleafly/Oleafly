export declare enum CommonPopupDataAttributes {
  /**
   * Present when the popup is open.
   */
  open = "data-open",
  /**
   * Present when the popup is closed.
   */
  closed = "data-closed",
  /**
   * Present when the popup is animating in.
   */
  startingStyle = "data-starting-style",
  /**
   * Present when the popup is animating out.
   */
  endingStyle = "data-ending-style",
  /**
   * Present when the anchor is hidden.
   */
  anchorHidden = "data-anchor-hidden",
  /**
   * Indicates which side the popup is positioned relative to the trigger.
   * @type { 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start'}
   */
  side = "data-side",
  /**
   * Indicates how the popup is aligned relative to specified side.
   * @type {'start' | 'center' | 'end'}
   */
  align = "data-align",
}
export declare enum CommonTriggerDataAttributes {
  /**
   * Present when the popup is open.
   */
  popupOpen = "data-popup-open",
  /**
   * Present when a pressable trigger is pressed.
   */
  pressed = "data-pressed",
}
export declare const triggerOpenStateMapping: {
  open(value: boolean): {
    "data-popup-open": string;
  } | null;
};
export declare const pressableTriggerOpenStateMapping: {
  open(value: boolean): {
    "data-popup-open": string;
    "data-pressed": string;
  } | null;
};
export declare const popupStateMapping: {
  open(value: boolean): {
    "data-open": string;
  } | {
    "data-closed": string;
  };
  anchorHidden(value: boolean): {
    "data-anchor-hidden": string;
  } | null;
};
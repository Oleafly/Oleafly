import { pressableTriggerOpenStateMapping } from "../../utils/popupStateMapping.mjs";
import { fieldValidityMapping } from "../../internals/field-constants/constants.mjs";
export const triggerStateAttributesMapping = {
  ...pressableTriggerOpenStateMapping,
  ...fieldValidityMapping,
  popupSide: side => side ? {
    'data-popup-side': side
  } : null,
  listEmpty: empty => empty ? {
    'data-list-empty': ''
  } : null
};
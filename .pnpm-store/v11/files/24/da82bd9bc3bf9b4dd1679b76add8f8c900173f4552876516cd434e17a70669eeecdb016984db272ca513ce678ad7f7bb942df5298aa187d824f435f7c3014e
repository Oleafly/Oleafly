"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AutocompleteRoot = AutocompleteRoot;
var React = _interopRequireWildcard(require("react"));
var _AriaCombobox = require("../../combobox/root/AriaCombobox");
var _useFilter = require("../../combobox/root/utils/useFilter");
var _resolveValueLabel = require("../../internals/resolveValueLabel");
var _reasons = require("../../internals/reasons");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Groups all parts of the autocomplete.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Autocomplete](https://base-ui.com/react/components/autocomplete)
 */

function AutocompleteRoot(props) {
  const {
    openOnInputClick = false,
    value,
    defaultValue,
    onValueChange,
    mode = 'list',
    itemToStringValue,
    ...other
  } = props;
  const enableInline = mode === 'inline' || mode === 'both';
  const staticItems = mode === 'inline' || mode === 'none';

  // Mirror the typed value for uncontrolled usage so we can compose the temporary
  // inline input value.
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? '');
  const [inlineInputValue, setInlineInputValue] = React.useState('');
  React.useEffect(() => {
    if (isControlled) {
      setInlineInputValue('');
    }
  }, [value, isControlled]);

  // Compose the input value shown to the user: inline value takes precedence when present.
  let resolvedInputValue;
  if (enableInline && inlineInputValue !== '') {
    resolvedInputValue = inlineInputValue;
  } else if (isControlled) {
    resolvedInputValue = value ?? '';
  } else {
    resolvedInputValue = internalValue;
  }
  const collator = (0, _useFilter.useCoreFilter)();
  const baseFilter = React.useMemo(() => {
    if (other.filter !== undefined) {
      return other.filter;
    }
    return collator.contains;
  }, [other.filter, collator]);
  const resolvedQuery = String(isControlled ? value : internalValue).trim();

  // In "both", wrap filtering to use only the typed value, ignoring the inline value.
  const resolvedFilter = React.useMemo(() => {
    if (mode !== 'both') {
      return staticItems ? null : baseFilter;
    }
    if (baseFilter === null) {
      return null;
    }
    return (item, _query, toString) => {
      return baseFilter(item, resolvedQuery, toString);
    };
  }, [baseFilter, mode, resolvedQuery, staticItems]);
  function handleValueChange(nextValue, eventDetails) {
    setInlineInputValue('');
    if (!isControlled) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue, eventDetails);
  }
  function handleItemHighlighted(highlightedValue, eventDetails) {
    props.onItemHighlighted?.(highlightedValue, eventDetails);
    if (eventDetails.reason === _reasons.REASONS.pointer) {
      return;
    }
    if (enableInline) {
      if (highlightedValue == null) {
        setInlineInputValue('');
      } else {
        setInlineInputValue((0, _resolveValueLabel.stringifyAsLabel)(highlightedValue, itemToStringValue));
      }
    } else {
      setInlineInputValue('');
    }
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_AriaCombobox.AriaCombobox, {
    ...other,
    itemToStringLabel: itemToStringValue,
    openOnInputClick: openOnInputClick,
    selectionMode: "none",
    fillInputOnItemPress: true,
    filter: resolvedFilter,
    autoComplete: mode,
    inputValue: resolvedInputValue,
    defaultInputValue: defaultValue,
    onInputValueChange: handleValueChange,
    onItemHighlighted: handleItemHighlighted
  });
}
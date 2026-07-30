'use client';

import * as React from 'react';
import { AriaCombobox } from "../../combobox/root/AriaCombobox.mjs";
import { useCoreFilter } from "../../combobox/root/utils/useFilter.mjs";
import { stringifyAsLabel } from "../../internals/resolveValueLabel.mjs";
import { REASONS } from "../../internals/reasons.mjs";

/**
 * Groups all parts of the autocomplete.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Autocomplete](https://base-ui.com/react/components/autocomplete)
 */
import { jsx as _jsx } from "react/jsx-runtime";
export function AutocompleteRoot(props) {
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
  const collator = useCoreFilter();
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
    if (eventDetails.reason === REASONS.pointer) {
      return;
    }
    if (enableInline) {
      if (highlightedValue == null) {
        setInlineInputValue('');
      } else {
        setInlineInputValue(stringifyAsLabel(highlightedValue, itemToStringValue));
      }
    } else {
      setInlineInputValue('');
    }
  }
  return /*#__PURE__*/_jsx(AriaCombobox, {
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
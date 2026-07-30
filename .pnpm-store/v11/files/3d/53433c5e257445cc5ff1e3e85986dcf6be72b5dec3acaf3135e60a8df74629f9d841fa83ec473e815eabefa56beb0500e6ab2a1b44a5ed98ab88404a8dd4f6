import { fillIndex } from "../../utils/miscUtil";
import * as React from 'react';
/**
 * Used to control each fields invalidate status
 */
export default function useFieldsInvalidate(calendarValue, isInvalidateDate, allowEmpty = []) {
  const [fieldsInvalidates, setFieldsInvalidates] = React.useState([false, false]);
  const onSelectorInvalid = (invalid, index) => {
    setFieldsInvalidates(ori => fillIndex(ori, index, invalid));
  };

  /**
   * For the Selector Input to mark as `aria-disabled`
   */
  const submitInvalidates = React.useMemo(() => {
    return fieldsInvalidates.map((invalid, index) => {
      // If typing invalidate
      if (invalid) {
        return true;
      }
      const current = calendarValue[index];

      // Not check if all empty
      if (!current) {
        return false;
      }

      // Not allow empty
      if (!allowEmpty[index] && !current) {
        return true;
      }

      // Invalidate
      if (current && isInvalidateDate(current, {
        activeIndex: index
      })) {
        return true;
      }
      return false;
    });
  }, [calendarValue, fieldsInvalidates, isInvalidateDate, allowEmpty]);
  return [submitInvalidates, onSelectorInvalid];
}
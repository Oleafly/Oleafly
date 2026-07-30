import { useControlledState } from '@rc-component/util';
export default function useMergedValue(defaultValue, controlledValue) {
  const [value, setValue] = useControlledState(defaultValue, controlledValue);
  const formatValue = value === undefined || value === null ? '' : String(value);
  return {
    value,
    setValue,
    formatValue
  };
}
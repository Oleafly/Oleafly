type MergedValue = string | number | readonly string[] | bigint | undefined;
export default function useMergedValue<ValueType extends MergedValue>(defaultValue?: ValueType, controlledValue?: ValueType): {
    value: ValueType | undefined;
    setValue: (updater: ValueType | ((origin: ValueType | undefined) => ValueType | undefined) | undefined) => void;
    formatValue: string;
};
export {};

export type ItemEqualityComparer<Item = any, Value = Item> = (itemValue: Item, selectedValue: Value) => boolean;
export declare const defaultItemEquality: ItemEqualityComparer;
export declare function compareItemEquality<Item, Value>(itemValue: Item, selectedValue: Value, comparer: ItemEqualityComparer<Item, Value>): boolean;
export declare function selectedValueIncludes<Item, Value>(selectedValues: readonly Item[] | undefined | null, itemValue: Value, comparer: ItemEqualityComparer<Value, Item>): boolean;
export declare function findItemIndex<Item, Value>(itemValues: readonly Item[] | undefined | null, selectedValue: Value, comparer: ItemEqualityComparer<Item, Value>): number;
export declare function removeItem<Item, Value>(selectedValues: readonly Item[], itemValue: Value, comparer: ItemEqualityComparer<Value, Item>): Item[];
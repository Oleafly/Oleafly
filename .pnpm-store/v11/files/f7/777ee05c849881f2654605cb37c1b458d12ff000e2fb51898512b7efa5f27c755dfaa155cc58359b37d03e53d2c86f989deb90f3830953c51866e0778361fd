import * as React from 'react';
import { isPlainObject } from '../../_util/is';
const useLazyKVMap = (data, childrenColumnName, getRowKey) => {
  const mapCacheRef = React.useRef({});
  function getRecordByKey(key) {
    if (!mapCacheRef.current || mapCacheRef.current.data !== data || mapCacheRef.current.childrenColumnName !== childrenColumnName || mapCacheRef.current.getRowKey !== getRowKey) {
      const kvMap = new Map();
      function dig(records) {
        records.forEach((record, index) => {
          const rowKey = getRowKey(record, index);
          kvMap.set(rowKey, record);
          if (isPlainObject(record) && childrenColumnName in record) {
            dig(record[childrenColumnName] || []);
          }
        });
      }
      dig(data);
      mapCacheRef.current = {
        data,
        childrenColumnName,
        kvMap,
        getRowKey
      };
    }
    return mapCacheRef.current.kvMap?.get(key);
  }
  return [getRecordByKey];
};
export default useLazyKVMap;
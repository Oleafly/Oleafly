import { kebabCase } from 'es-toolkit';
import { useId, useMemo } from 'react';
export var useFillId = function useFillId(namespace) {
  var uniqueId = useId();
  var id = "lobe-icons-".concat(kebabCase(namespace), "-").concat(uniqueId);
  return useMemo(function () {
    return {
      fill: "url(#".concat(id, ")"),
      id: id
    };
  }, [namespace]);
};
export var useFillIds = function useFillIds(namespace, length) {
  var uniqueId = useId();
  return useMemo(function () {
    return Array.from({
      length: length
    }, function (_, i) {
      var id = "lobe-icons-".concat(kebabCase(namespace), "-").concat(i, "-").concat(uniqueId);
      return {
        fill: "url(#".concat(id, ")"),
        id: id
      };
    });
  }, [namespace, length, uniqueId]);
};
import { QrCode, QrSegment } from "../libs/qrcodegen";
import { ERROR_LEVEL_MAP, getImageSettings, getMarginSize } from "../utils";
import React from 'react';
export const useQRCode = opt => {
  const {
    value,
    level,
    minVersion,
    includeMargin,
    marginSize,
    imageSettings,
    size,
    boostLevel
  } = opt;
  const memoizedQrcode = React.useMemo(() => {
    const values = Array.isArray(value) ? value : [value];
    const segments = values.reduce((acc, val) => {
      acc.push(...QrSegment.makeSegments(val));
      return acc;
    }, []);
    return QrCode.encodeSegments(segments, ERROR_LEVEL_MAP[level], minVersion, undefined, undefined, boostLevel);
  }, [value, level, minVersion, boostLevel]);
  return React.useMemo(() => {
    const cs = memoizedQrcode.getModules();
    const mg = getMarginSize(includeMargin, marginSize);
    const ncs = cs.length + mg * 2;
    const cis = getImageSettings(cs, size, mg, imageSettings);
    return {
      cells: cs,
      margin: mg,
      numCells: ncs,
      calculatedImageSettings: cis,
      qrcode: memoizedQrcode
    };
  }, [memoizedQrcode, size, imageSettings, includeMargin, marginSize]);
};
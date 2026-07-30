import { useEffect, useRef } from 'react';

export function useRenderCount(name?: string): number {
  const count = useRef(1);

  useEffect(() => {
    count.current += 1;
  });

  // eslint-disable-next-line no-console
  console.log(
    `%c${name || 'RenderCount'}: %c${count.current}`,
    'font-size: 14px;  font-weight: bold;',
    'color: #999; font-size: 14px;',
  );

  return count.current;
}

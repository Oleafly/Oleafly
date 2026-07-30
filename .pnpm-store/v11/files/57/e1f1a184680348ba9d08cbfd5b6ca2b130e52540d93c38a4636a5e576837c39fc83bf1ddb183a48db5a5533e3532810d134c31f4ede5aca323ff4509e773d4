import { useEffect, useLayoutEffect } from 'react';

import { canUseDOM } from './utils';

export const useIsomorphicLayoutEffect = canUseDOM() ? useLayoutEffect : useEffect;

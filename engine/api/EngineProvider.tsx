import React, { createContext, useContext, useMemo } from 'react';
import type { EngineAPI } from './EngineAPI';
import { createEngineAPI } from './createEngineAPI';

const EngineAPIContext = createContext<EngineAPI | null>(null);

export const EngineProvider: React.FC<React.PropsWithChildren<{ engine?: any; api?: EngineAPI }>> = ({ children, engine, api: customApi }) => {
  const api = useMemo(() => customApi ?? (engine ? createEngineAPI(engine) : createEngineAPI()), [engine, customApi]);
  return <EngineAPIContext.Provider value={api}>{children}</EngineAPIContext.Provider>;
};

export function useEngineAPI(): EngineAPI {
  const ctx = useContext(EngineAPIContext);
  if (!ctx) throw new Error('useEngineAPI must be used within <EngineProvider>');
  return ctx;
}

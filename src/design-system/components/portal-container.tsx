import { createContext, useContext } from 'react';

const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export const PortalContainerProvider = PortalContainerContext.Provider;
export const usePortalContainer = () => useContext(PortalContainerContext);

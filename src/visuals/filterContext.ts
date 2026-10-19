// Extra filters for the visuals rendered inside a report-page tooltip (the hovered data point).
import { createContext, useContext } from 'react';
import type { Filter } from '../types';

export const ExtraFilters = createContext<Filter[]>([]);
export const useExtraFilters = () => useContext(ExtraFilters);

import { createContext, useContext } from 'react';
export type Currency = 'USD' | 'KZT' | 'EUR' | 'RUB';
interface FinanceState {
    revision: number;
    refresh: () => void;
    currency: Currency;
    setCurrency: (value: Currency) => Promise<void>;
    rates: Record<Currency, number>;
    preferenceError: string;
    preferenceLoading: boolean;
}
export const FinanceContext = createContext<FinanceState | null>(null);
export function useFinance() {
    const state = useContext(FinanceContext);
    if (!state)
        throw new Error('FinanceProvider is required');
    return state;
}

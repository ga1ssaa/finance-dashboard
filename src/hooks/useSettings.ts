import { useFinance } from '../state/financeStore';
import { fromUSD, toUSD } from '../utils/money';
export type { Currency } from '../state/financeStore';
import type { Currency } from '../state/financeStore';
export const CURRENCY_SYMBOLS: Record<Currency, string> = { USD: '$', KZT: '₸', EUR: '€', RUB: '₽' };
export function useSettings() {
    const state = useFinance();
    const convertAmount = (value: string | number, target: Currency = state.currency) => Number(value) * state.rates[target];
    const formatAmount = (value: string | number, target: Currency = state.currency) => `${CURRENCY_SYMBOLS[target]} ${convertAmount(value, target).toLocaleString('ru-RU', { minimumFractionDigits: target === 'KZT' || target === 'RUB' ? 0 : 2, maximumFractionDigits: target === 'KZT' || target === 'RUB' ? 0 : 2 })}`;
    return { ...state, convertAmount, formatAmount, toBaseCurrency: (value: string) => toUSD(value, String(state.rates[state.currency])), inputAmount: (value: string) => fromUSD(value, String(state.rates[state.currency])) };
}

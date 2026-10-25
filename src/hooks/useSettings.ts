import { useFinance } from '../state/financeStore';
import { displayFromUSD, formatDisplayDecimal, fromUSD, toUSD } from '../utils/money';
import { freshRate } from '../utils/exchangeRates';
export type { Currency } from '../state/financeStore';
import type { Currency } from '../state/financeStore';
export const CURRENCY_SYMBOLS: Record<Currency, string> = { USD: '$', KZT: '₸', EUR: '€', RUB: '₽' };
export function useSettings() {
    const state = useFinance();
    let conversionError = '';
    try { freshRate(state.currency, state.rates, state.ratesUpdatedAt); }
    catch (error) { conversionError = state.rateError || (error instanceof Error ? error.message : 'Exchange rates unavailable.'); }
    const convertAmount = (value: string | number, target: Currency = state.currency) => displayFromUSD(value, freshRate(target, state.rates, state.ratesUpdatedAt));
    const formatAmount = (value: string | number, target: Currency = state.currency) => {
        try { return `${CURRENCY_SYMBOLS[target]} ${formatDisplayDecimal(convertAmount(value, target), target === 'KZT' || target === 'RUB' ? 0 : 2)}`; }
        catch { return `${CURRENCY_SYMBOLS[target]} —`; }
    };
    return {
        ...state, convertAmount, formatAmount,
        // Keep the currency selector usable so USD remains an escape from a pending rate service.
        preferenceLoading: state.preferenceLoading,
        preferenceError: state.preferenceError || (conversionError && state.ratesLoading ? 'Exchange rates are loading. Choose USD or wait before opening monetary forms.' : conversionError),
        toBaseCurrency: (value: string) => toUSD(value, freshRate(state.currency, state.rates, state.ratesUpdatedAt)),
        inputAmount: (value: string) => fromUSD(value, freshRate(state.currency, state.rates, state.ratesUpdatedAt)),
    };
}

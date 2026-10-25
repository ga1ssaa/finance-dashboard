import { sameDecimalAmount, validateExchangeRate } from './money.ts';
import type { Currency } from '../state/financeStore';

export const RATE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const RATE_REFRESH_MS = 12 * 60 * 60 * 1000;
export type Rates = Partial<Record<Currency, string | number>>;
export interface RateSnapshot { rates: Record<Currency, string>; publishedAt: number; fetchedAt: number }
const currencies = ['USD', 'EUR', 'KZT', 'RUB'] as const;

export function rateIsFresh(publishedAt: number | null | undefined, now = Date.now()): boolean {
    return typeof publishedAt === 'number' && Number.isSafeInteger(publishedAt) && publishedAt > 0 && publishedAt <= now && now - publishedAt <= RATE_MAX_AGE_MS;
}

export function freshRate(currency: Currency, rates: Rates, publishedAt: number | null | undefined, now = Date.now()): string {
    if (currency === 'USD') return '1'; // Canonical currency needs no external quote.
    const rate = validateExchangeRate(rates[currency]);
    if (!rateIsFresh(publishedAt, now)) throw new Error('Exchange rates are missing or stale. Retry loading rates or choose USD. Reopen this form after rates refresh.');
    return rate;
}

function validatedRates(value: unknown): Record<Currency, string> {
    if (!value || typeof value !== 'object') throw new Error('Exchange rates unavailable.');
    const rates = Object.fromEntries(currencies.map(currency => [currency, validateExchangeRate((value as Rates)[currency])])) as Record<Currency, string>;
    if (!sameDecimalAmount(rates.USD, '1')) throw new Error('Exchange rates must use USD as their base.');
    return rates;
}

export function readRateCache(storage: Pick<Storage, 'getItem'>, now = Date.now()): RateSnapshot | null {
    try {
        const value = JSON.parse(storage.getItem('finance_app_exchange_rates') || 'null');
        // Legacy caches have no provider publication time, so they cannot authorize conversion.
        if (!value || !rateIsFresh(value.publishedAt, now) || !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt > now || value.fetchedAt < value.publishedAt) return null;
        return { rates: validatedRates(value.rates), publishedAt: value.publishedAt, fetchedAt: value.fetchedAt };
    } catch { return null; }
}

/** Preserve JSON numeric tokens as strings before parsing; no exchange quote passes through binary floats. */
export function parseRateResponse(text: string, now = Date.now()): RateSnapshot {
    const tokens = text.replace(/("(?:\\.|[^"\\])*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (token, quoted) => quoted || JSON.stringify(token));
    const value = JSON.parse(tokens);
    const publishedAt = Number(value.time_last_update_unix) * 1000;
    if (value.result !== 'success' || value.base_code !== 'USD' || !rateIsFresh(publishedAt, now)) throw new Error('The exchange-rate response is invalid or stale. Choose USD or retry loading rates.');
    return { rates: validatedRates(value.rates), publishedAt, fetchedAt: now };
}

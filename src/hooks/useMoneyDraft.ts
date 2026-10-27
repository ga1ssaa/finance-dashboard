import { useState } from 'react';
import type { Currency } from '../state/financeStore';
import { freshRate, type Rates } from '../utils/exchangeRates';
import { fromUSD, normalizeMoneyInput, sameDecimalAmount, toUSD, units, validateExchangeRate } from '../utils/money';

interface Settings {
    currency: Currency;
    rates: Rates;
    ratesUpdatedAt?: number | null;
}

/** Freeze the quote and original USD fields for the lifetime of a mounted form. */
export function useMoneyDraft<Key extends string>(settings: Settings, originals: Partial<Record<Key, string>>, fields: readonly Key[]) {
    const [snapshot] = useState(() => {
        const sourceCurrency = settings.currency;
        let rate: string | null = null;
        let warning = '';
        try {
            rate = sourceCurrency === 'USD' ? '1' : validateExchangeRate(settings.rates[sourceCurrency]);
            freshRate(sourceCurrency, { [sourceCurrency]: rate }, settings.ratesUpdatedAt);
        } catch (error) {
            warning = error instanceof Error ? error.message : 'Exchange rate unavailable.';
        }
        const hasOriginals = fields.some(key => originals[key] !== undefined);
        // Without a valid quote, show originals in USD and allow unchanged edits only.
        const currency = !rate && hasOriginals ? 'USD' : sourceCurrency;
        if (!rate) warning += hasOriginals
            ? ' Original amounts are shown in USD; only unchanged amounts can be saved. Choose USD or refresh rates and reopen to change them.'
            : ' Choose USD or refresh rates and reopen this form.';
        const initialValues = Object.fromEntries(fields.map(key => [key, originals[key] === undefined ? '' : rate ? fromUSD(originals[key], rate) : originals[key]])) as Record<Key, string>;
        return { currency, sourceCurrency, rate, publishedAt: settings.ratesUpdatedAt, warning, originals: { ...originals }, initialValues };
    });
    const [values, setValues] = useState(snapshot.initialValues);
    const changed = (key: Key) => values[key].startsWith('-') || snapshot.originals[key] === undefined || !sameDecimalAmount(values[key], snapshot.initialValues[key]);
    const resolve = (key: Key): string => {
        const original = snapshot.originals[key];
        if (original !== undefined && !changed(key)) return original;
        if (!snapshot.rate) throw new Error(snapshot.warning);
        const rate = freshRate(snapshot.sourceCurrency, { [snapshot.sourceCurrency]: snapshot.rate }, snapshot.publishedAt);
        // Same boundary policy as TransactionModal: no intermediate rounding or Number arithmetic.
        const canonical = snapshot.sourceCurrency === 'USD' ? normalizeMoneyInput(values[key]) : toUSD(values[key], rate, 'half-even');
        // Budgets and subscriptions allow an explicit zero, but never a lost positive amount.
        if (units(canonical) === 0n && !sameDecimalAmount(values[key], '0')) throw new Error('Amount rounds below the minimum 0.00000001 USD.');
        return canonical;
    };
    return {
        currency: snapshot.currency, warning: snapshot.warning, values, changed, resolve,
        setValue: (key: Key, value: string) => setValues(previous => ({ ...previous, [key]: value })),
    };
}

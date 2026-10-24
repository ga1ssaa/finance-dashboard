import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { request } from '../api/client';
import { FinanceContext } from './financeStore';
import type { Currency } from './financeStore';
const defaultRates = { USD: 1, KZT: 475, EUR: .92, RUB: 88 };
export function FinanceProvider({ children }: {
    children: ReactNode;
}) {
    const [revision, setRevision] = useState(0);
    const [currency, updateCurrency] = useState<Currency>('USD');
    const [rates, setRates] = useState(() => {
        try {
            const cached = JSON.parse(localStorage.getItem('finance_app_exchange_rates') || 'null');
            if (cached && Object.keys(defaultRates).every(key => Number.isFinite(cached[key]) && cached[key] > 0))
                return cached as typeof defaultRates;
        }
        catch { /* use fallback rates */ }
        return defaultRates;
    });
    const [preferenceError, setPreferenceError] = useState('');
    const [preferenceLoading, setPreferenceLoading] = useState(true);
    const saving = useRef(false);
    const preferenceGeneration = useRef(0);
    const refresh = useCallback(() => setRevision(value => value + 1), []);
    useEffect(() => {
        const controller = new AbortController();
        const generation = preferenceGeneration.current;
        request<{ display_currency: Currency }>('/preferences', { signal: controller.signal })
            .then(value => {
                if (controller.signal.aborted || generation !== preferenceGeneration.current || saving.current) {
                    return;
                }
                updateCurrency(value.display_currency);
                setPreferenceError('');
            })
            .catch(error => {
                if (!controller.signal.aborted && generation === preferenceGeneration.current && !saving.current) {
                    setPreferenceError(error.message);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted && generation === preferenceGeneration.current && !saving.current) {
                    setPreferenceLoading(false);
                }
            });
        return () => controller.abort();
    }, [revision]);
    useEffect(() => {
        // Only exchange-rate cache is browser-local; financial legacy keys stay untouched.
        const lastUpdated = Number(localStorage.getItem('finance_app_rates_updated_at') || 0);
        if (Date.now() - lastUpdated < 12 * 60 * 60 * 1000)
            return;
        const controller = new AbortController();
        fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal }).then(response => response.json()).then(data => {
            if (!data.rates)
                return;
            const next = { USD: 1, KZT: data.rates.KZT, EUR: data.rates.EUR, RUB: data.rates.RUB };
            if (Object.values(next).every(value => Number.isFinite(value) && value > 0)) {
                setRates(next);
                localStorage.setItem('finance_app_exchange_rates', JSON.stringify(next));
                localStorage.setItem('finance_app_rates_updated_at', String(Date.now()));
            }
        }).catch(() => { });
        return () => controller.abort();
    }, []);
    const setCurrency = async (value: Currency) => {
        if (saving.current)
            return;
        preferenceGeneration.current += 1;
        saving.current = true;
        setPreferenceLoading(true);
        setPreferenceError('');
        try {
            const saved = await request<{
                display_currency: Currency;
            }>('/preferences', { method: 'PATCH', body: JSON.stringify({ display_currency: value }) });
            updateCurrency(saved.display_currency);
            setPreferenceError('');
        }
        catch (error) {
            setPreferenceError(error instanceof Error ? error.message : 'Unable to save currency.');
        }
        finally {
            saving.current = false;
            setPreferenceLoading(false);
        }
    };
    return (
        <FinanceContext.Provider value={{ revision, refresh, currency, setCurrency, rates, preferenceError, preferenceLoading }}>
            {children}
        </FinanceContext.Provider>
    );
}

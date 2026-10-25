import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { request } from '../api/client';
import { FinanceContext } from './financeStore';
import type { Currency } from './financeStore';
import { useAuth } from './authStore';
import { dismissDataOperationNotice, getDataOperationState, subscribeDataOperations } from '../api/dataOperations';
import { DataOperationGate } from '../components/DataConfirmationDialog';
import { parseRateResponse, rateIsFresh, RATE_REFRESH_MS, readRateCache } from '../utils/exchangeRates';
const canonicalRate = { USD: '1' };
function FinanceDataProvider({ children }: {
    children: ReactNode;
}) {
    const [revision, setRevision] = useState(0);
    const [currency, updateCurrency] = useState<Currency>('USD');
    const [quote, setQuote] = useState(() => {
        try { return readRateCache(localStorage); } catch { return null; }
    });
    const rates = quote?.rates || canonicalRate;
    const [ratesLoading, setRatesLoading] = useState(!quote);
    const [rateError, setRateError] = useState('');
    const [preferenceError, setPreferenceError] = useState('');
    const [preferencesReady, setPreferencesReady] = useState(false);
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
                setPreferencesReady(true);
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
        if (quote && rateIsFresh(quote.publishedAt) && Date.now() - quote.fetchedAt < RATE_REFRESH_MS) return;
        const controller = new AbortController();
        Promise.resolve().then(() => {
            if (controller.signal.aborted) throw new Error('Exchange-rate request canceled.');
            setRatesLoading(true);
            return fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
        })
            .then(async response => {
                if (!response.ok) throw new Error('Unable to load exchange rates. Choose USD or retry.');
                return parseRateResponse(await response.text());
            })
            .then(next => {
                if (controller.signal.aborted) return;
                setQuote(next);
                setRatesLoading(false);
                setRateError('');
                // Cache failure must not discard a validated in-memory quote.
                try { localStorage.setItem('finance_app_exchange_rates', JSON.stringify(next)); } catch { /* memory remains usable */ }
            })
            .catch(error => {
                if (!controller.signal.aborted) setRateError(error instanceof Error ? error.message : 'Exchange rates unavailable.');
            })
            .finally(() => { if (!controller.signal.aborted) setRatesLoading(false); });
        return () => controller.abort();
    }, [revision, quote]);
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
        <FinanceContext.Provider value={{ revision, refresh, currency, setCurrency, rates, ratesUpdatedAt: quote?.publishedAt ?? null, ratesLoading, rateError, preferenceError, preferenceLoading }}>
            {preferencesReady ? children : (
                <main className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
                    <div className="space-y-4 text-slate-700 dark:text-slate-200">
                        {preferenceError ? <p role="alert">Unable to load account preferences. Financial pages remain paused.</p> : <p role="status">Loading account preferences…</p>}
                        {preferenceError && <button type="button" onClick={refresh} className="rounded-lg bg-blue-600 px-4 py-2 text-white">Retry loading account data</button>}
                    </div>
                </main>
            )}
        </FinanceContext.Provider>
    );
}

export function FinanceProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const userId = user?.id || '';
    const operationState = useSyncExternalStore(subscribeDataOperations, () => getDataOperationState(userId));
    if (operationState.operation) {
        return <DataOperationGate key={`${operationState.operation.key}:${operationState.operation.status}`} operation={operationState.operation} />;
    }
    // Unmount the entire financial provider during a command. Its return starts clean caches and drafts.
    return (
        <>
            {operationState.notice && (
                <div role={operationState.notice.code === 'OPERATION_COMPLETED' ? 'status' : 'alert'} className="p-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex justify-between gap-4">
                    <span>{operationState.notice.message}</span>
                    <button type="button" onClick={() => dismissDataOperationNotice(userId)} className="underline">Dismiss</button>
                </div>
            )}
            <FinanceDataProvider key={operationState.revision}>{children}</FinanceDataProvider>
        </>
    );
}

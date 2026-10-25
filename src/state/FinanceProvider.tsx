import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { request } from '../api/client';
import { FinanceContext } from './financeStore';
import type { Currency } from './financeStore';
import { useAuth } from './authStore';
import { dismissDataOperationNotice, getDataOperationState, subscribeDataOperations } from '../api/dataOperations';
import { DataOperationGate } from '../components/DataConfirmationDialog';
const defaultRates = { USD: 1, KZT: 475, EUR: .92, RUB: 88 };
function FinanceDataProvider({ children }: {
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

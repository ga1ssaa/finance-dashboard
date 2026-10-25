import { useEffect, useRef, useState } from "react";
import { downloadAccountExport } from "../api/dataExport";
import ResourceStatus from "../components/ResourceStatus";
import DangerZone from "../features/settings/DangerZone";
import { Moon, Sun, Download, Upload, DollarSign } from "lucide-react";
import { useSettings, CURRENCY_SYMBOLS, type Currency } from "../hooks/useSettings";

interface SettingsPageProps {
    isDarkMode?: boolean;
    toggleTheme?: () => void;
}

function SettingsPage({ isDarkMode, toggleTheme }: SettingsPageProps) {
    const { currency, setCurrency, preferenceError, preferenceLoading, refresh } = useSettings();
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');
    const [exportMessage, setExportMessage] = useState('');
    const pendingExport = useRef<AbortController | null>(null);
    useEffect(() => () => {
        pendingExport.current?.abort();
        pendingExport.current = null;
    }, []);
    const handleExport = async () => {
        if (pendingExport.current) return;
        const controller = new AbortController();
        pendingExport.current = controller;
        setExporting(true);
        setExportError('');
        setExportMessage('');
        try {
            await downloadAccountExport(controller.signal);
            if (pendingExport.current === controller && !controller.signal.aborted) {
                setExportMessage('Download started. Check your browser downloads.');
            }
        } catch (error) {
            if (pendingExport.current === controller && !controller.signal.aborted) {
                setExportError(error instanceof Error ? error.message : 'Export failed. Please retry.');
            }
        } finally {
            if (pendingExport.current === controller) {
                pendingExport.current = null;
                setExporting(false);
            }
        }
    };
    const cancelExport = () => {
        pendingExport.current?.abort();
        pendingExport.current = null;
        setExporting(false);
        setExportError('');
        setExportMessage('Export canceled.');
    };
    return (
        <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                    Settings
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                    Manage your app preferences and data backups
                </p>
            </div>

                {toggleTheme && (
                <button
                    onClick={toggleTheme}
                    className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer w-fit"
                    title="Toggle Dark Mode"
                >
                    {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                )}
        </div>

        <div className="max-w-4xl space-y-6">
            <ResourceStatus error={preferenceError} retry={refresh} />
            {/* Currency Preference */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                            <DollarSign size={20} className="text-blue-500" />
                            Currency Symbol
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Choose the main currency for your application interface
                        </p>
                    </div>

                    <select
                    disabled={preferenceLoading}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white font-bold border border-slate-200 dark:border-slate-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                    {(Object.keys(CURRENCY_SYMBOLS) as Currency[]).map((curr) => (
                        <option key={curr} value={curr}>
                        {curr} ({CURRENCY_SYMBOLS[curr]})
                        </option>
                    ))}
                    </select>
                </div>
            </div>

            {/* Backup & Restore Data */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors space-y-4">
            <div>
                <h3 className="font-semibold text-lg text-slate-800 dark:text-white">
                Data Backup & Restore
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Download all account transactions, subscriptions, budget inputs and currency preference as JSON. Amounts are exported in USD. Downloaded files contain unencrypted financial data; store them privately. Import and reset remain unavailable; existing browser data is left untouched.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            disabled={exporting}
                            aria-busy={exporting}
                            onClick={handleExport}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
                            >
                            <Download size={18} aria-hidden="true" />
                            {exporting ? 'Preparing export…' : 'Export Backup'}
                        </button>

                        {exporting && (
                            <button
                                type="button"
                                onClick={cancelExport}
                                className="px-4 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                                Cancel export
                            </button>
                        )}
                        <button
                            disabled title="Unavailable for API-managed data"
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors cursor-pointer"
                            >
                            <Upload size={18} />
                            Import Backup
                        </button>

                    </div>
                    {exporting && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Preparing your account export…</p>}
                    {exportError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{exportError}</p>}
                    {exportMessage && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{exportMessage}</p>}
                </div>

                {/* Danger Zone */}
                <DangerZone />
            </div>
        </div>
    );
}
export default SettingsPage
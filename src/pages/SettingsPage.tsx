import { useEffect, useRef, useState } from "react";
import { downloadAccountExport } from "../api/dataExport";
import { previewImportFile } from "../api/importPreview";
import type { ImportPreview, ResourceCounts } from "../api/importPreview";
import { getSessionEpoch } from "../api/authSession";
import ResourceStatus from "../components/ResourceStatus";
import { DataConfirmationDialog } from "../components/DataConfirmationDialog";
import { Moon, Sun, Download, Upload, DollarSign } from "lucide-react";
import { useSettings, CURRENCY_SYMBOLS, type Currency } from "../hooks/useSettings";

const previewResources: { key: keyof ResourceCounts; label: string }[] = [
    { key: 'transactions', label: 'Transactions' },
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'budget_profiles', label: 'Budget profile' },
    { key: 'preferences', label: 'Currency preference' },
];

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
    const [previewing, setPreviewing] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [confirmationKind, setConfirmationKind] = useState<'import_replace' | 'reset' | null>(null);
    const [selectedPreviewFile, setSelectedPreviewFile] = useState<File | null>(null);
    const fileInput = useRef<HTMLInputElement | null>(null);
    const previewGeneration = useRef(0);
    const pendingPreview = useRef<{ controller: AbortController; file: File; generation: number; epoch: number } | null>(null);
    useEffect(() => () => {
        pendingExport.current?.abort();
        pendingExport.current = null;
        previewGeneration.current += 1;
        pendingPreview.current?.controller.abort();
        pendingPreview.current = null;
    }, []);
    useEffect(() => {
        if (!preview) return;
        const timer = setTimeout(() => {
            setSelectedPreviewFile(null);
            setPreview(null);
            setConfirmationKind(null);
            setPreviewError('The preview expired. Select the backup again for a fresh preview.');
        }, Math.max(0, Date.parse(preview.expires_at) - Date.now()));
        return () => clearTimeout(timer);
    }, [preview]);
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
    const handlePreviewFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file || pendingPreview.current?.file === file) return;
        setConfirmationKind(null);
        setSelectedPreviewFile(null);
        const generation = ++previewGeneration.current;
        const epoch = getSessionEpoch();
        pendingPreview.current?.controller.abort();
        const controller = new AbortController();
        const operation = { controller, file, generation, epoch };
        pendingPreview.current = operation;
        setPreview(null);
        setPreviewError('');
        setPreviewing(true);
        const isCurrent = () => pendingPreview.current === operation
            && generation === previewGeneration.current && epoch === getSessionEpoch() && !controller.signal.aborted;
        try {
            const result = await previewImportFile(file, controller.signal);
            if (isCurrent()) {
                setSelectedPreviewFile(file);
                setPreview(result);
            }
        } catch (error) {
            if (isCurrent()) setPreviewError(error instanceof Error ? error.message : 'Unable to preview this backup.');
        } finally {
            if (isCurrent()) {
                pendingPreview.current = null;
                setPreviewing(false);
            }
        }
    };
    const cancelPreview = () => {
        previewGeneration.current += 1;
        pendingPreview.current?.controller.abort();
        pendingPreview.current = null;
        setPreviewing(false);
        setPreview(null);
        setSelectedPreviewFile(null);
        setConfirmationKind(null);
        setPreviewError('');
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
                Download all account transactions, subscriptions, budget inputs and currency preference as JSON. Amounts are exported in USD. Downloaded files contain unencrypted financial data; store them privately. Import preview checks a version 1 USD backup without changing your account. Replacing or resetting account data requires a fresh preview, password and explicit confirmation. Legacy migration remains unavailable; existing browser data is left untouched.
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
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors cursor-pointer"
                        >
                            <Upload size={18} aria-hidden="true" />
                            Import Backup
                        </button>
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".json,application/json"
                            aria-label="Select JSON backup for preview"
                            onChange={handlePreviewFile}
                            hidden
                        />
                        {previewing && (
                            <button type="button" onClick={cancelPreview} className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">
                                Cancel preview
                            </button>
                        )}

                    </div>
                    {exporting && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Preparing your account export…</p>}
                    {exportError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{exportError}</p>}
                    {exportMessage && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{exportMessage}</p>}
                </div>

                <section aria-label="Import preview" className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 space-y-4">
                    <h3 className="font-semibold text-lg text-slate-800 dark:text-white">Import preview</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300">Previewing writes no account data. Select a JSON backup up to 5 MiB using Import Backup. Importing requires a separate confirmation.</p>
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">REPLACE removes your existing account data and creates the file’s data. Review the impact before opening the separate confirmation dialog.</p>
                    {previewing && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Validating backup and calculating replacement impact…</p>}
                    {previewError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{previewError}</p>}
                    {preview && (
                        <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
                            <p role="status">Valid version {preview.source.schema_version} {preview.source.base_currency} backup. No account data was changed.</p>
                            <p>Backup exported at: {preview.source.exported_at}</p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <caption className="text-left font-semibold mb-2">Replacement impact if confirmed</caption>
                                    <thead>
                                        <tr>
                                            <th scope="col" className="py-2">Data</th>
                                            <th scope="col">In file</th>
                                            <th scope="col">Current account</th>
                                            <th scope="col">Would remove</th>
                                            <th scope="col">Would create</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewResources.map(({ key, label }) => (
                                            <tr key={key} className="border-t border-slate-100 dark:border-slate-700">
                                                <th scope="row" className="py-2 font-medium">{label}</th>
                                                <td>{preview.source.counts[key]}</td>
                                                <td>{preview.current.counts[key]}</td>
                                                <td>{preview.replacement_impact.would_remove[key]}</td>
                                                <td>{preview.replacement_impact.would_create[key]}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p>
                                Budget in file: {preview.source.counts.budget_profiles ? 'Present' : 'Absent'};
                                current account: {preview.current.counts.budget_profiles ? 'Present' : 'Absent'}.
                                Currency preference in file: {preview.source.counts.preferences ? 'Present' : 'Absent'};
                                current account: {preview.current.counts.preferences ? 'Present' : 'Absent'}.
                            </p>
                            <ul className="list-disc pl-5 space-y-1">
                                {preview.warnings.map((warning, index) => (
                                    <li key={`${warning.code}-${index}`}>{warning.message}</li>
                                ))}
                            </ul>
                            <p className="break-all">File SHA-256 digest: <code>{preview.document_sha256}</code></p>
                            <p className="text-xs text-slate-500">This digest identifies the file only. It does not authorize an import.</p>
                        </div>
                    )}
                    <button
                        type="button"
                        disabled={!preview || previewing}
                        onClick={() => {
                            if (preview && Date.parse(preview.expires_at) > Date.now() && selectedPreviewFile) setConfirmationKind('import_replace');
                        }}
                        className="px-4 py-2 rounded-xl bg-red-600 text-white disabled:opacity-50"
                    >
                        Review import confirmation
                    </button>
                </section>

                <section className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-red-200 dark:border-red-900/30 space-y-3">
                    <h3 className="font-semibold text-lg text-slate-800 dark:text-white">Reset financial data</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Reset deletes transactions, subscriptions, budget inputs and the currency preference. Your login account is kept. Review a fresh preview before confirming.</p>
                    <button type="button" onClick={() => setConfirmationKind('reset')} className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-bold">Review account reset</button>
                </section>
                {confirmationKind && (
                    <DataConfirmationDialog
                        key={confirmationKind}
                        kind={confirmationKind}
                        initialPreview={confirmationKind === 'import_replace' ? preview || undefined : undefined}
                        initialFile={confirmationKind === 'import_replace' ? selectedPreviewFile || undefined : undefined}
                        onClose={() => {
                            setConfirmationKind(null);
                            setPreview(null);
                            setSelectedPreviewFile(null);
                        }}
                    />
                )}
            </div>
        </div>
    );
}
export default SettingsPage
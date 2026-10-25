import SelectControl from "../components/SelectControl";
import { useEffect, useRef, useState } from "react";
import { downloadAccountExport } from "../api/dataExport";
import { previewImportFile } from "../api/importPreview";
import type { ImportPreview, ResourceCounts } from "../api/importPreview";
import { getSessionEpoch } from "../api/authSession";
import ResourceStatus from "../components/ResourceStatus";
import { DataConfirmationDialog } from "../components/DataConfirmationDialog";
import { Download, Upload, DollarSign } from "lucide-react";
import { useSettings, CURRENCY_SYMBOLS, type Currency } from "../hooks/useSettings";

const previewResources: { key: keyof ResourceCounts; label: string }[] = [
    { key: 'transactions', label: 'Transactions' },
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'budget_profiles', label: 'Budget profile' },
    { key: 'preferences', label: 'Currency preference' },
];

function SettingsPage() {
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
        <div className="ui-page">
        {/* Page Header */}
        <div className="ui-page-header">
            <div>
                <h2 className="ui-page-title">
                    Settings
                </h2>
                <p className="ui-page-description">
                    Manage your app preferences and data backups
                </p>
            </div>
        </div>

        <div className="min-w-0 max-w-4xl space-y-4">
            <ResourceStatus error={preferenceError} retry={refresh} />
            {/* Currency Preference */}
            <div className="ui-panel">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-lg text-primary flex items-center gap-2">
                            <DollarSign size={20} className="text-accent" />
                            Currency Symbol
                        </h3>
                        <p className="text-sm leading-6 text-secondary mt-1">
                            Choose the main currency for your application interface
                        </p>
                    </div>

                    <SelectControl
                        containerClassName="shrink-0"
                        aria-label="Display currency"
                        disabled={preferenceLoading}
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as Currency)}
                        className="pl-4 py-2 rounded-control bg-muted text-primary font-medium border border-control dark:border-control cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                        {(Object.keys(CURRENCY_SYMBOLS) as Currency[]).map((curr) => (
                            <option key={curr} value={curr}>
                                {curr} ({CURRENCY_SYMBOLS[curr]})
                            </option>
                        ))}
                    </SelectControl>
                </div>
            </div>

            {/* Backup & Restore Data */}
            <div className="ui-panel space-y-4">
            <div>
                <h3 className="font-semibold text-lg text-primary">
                Data Backup & Restore
                </h3>
                <p className="text-sm leading-6 text-secondary mt-1">
                Download all account transactions, subscriptions, budget inputs and currency preference as JSON. Amounts are exported in USD.
                </p>
                <p className="mt-2 text-xs leading-5 text-secondary">Downloaded files contain unencrypted financial data; store them privately.</p>
                <p className="mt-2 text-sm leading-6 text-secondary">Import preview checks a version 1 USD backup without changing your account. Replacing or resetting account data requires a fresh preview, password and explicit confirmation.</p>
                <p className="mt-2 text-xs leading-5 text-secondary">Legacy migration remains unavailable; existing browser data is left untouched.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            disabled={exporting}
                            aria-busy={exporting}
                            onClick={handleExport}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-secondary bg-muted hover:bg-hover dark:hover:bg-hover rounded-control transition-colors cursor-pointer disabled:opacity-60"
                            >
                            <Download size={18} aria-hidden="true" />
                            {exporting ? 'Preparing export…' : 'Export Backup'}
                        </button>

                        {exporting && (
                            <button
                                type="button"
                                onClick={cancelExport}
                                className="px-4 py-2.5 text-sm font-medium text-secondary rounded-control focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                Cancel export
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-secondary bg-muted hover:bg-hover dark:hover:bg-hover rounded-control transition-colors cursor-pointer"
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
                            <button type="button" onClick={cancelPreview} className="px-4 py-2.5 text-sm text-secondary">
                                Cancel preview
                            </button>
                        )}

                    </div>
                    {exporting && <p role="status" className="text-sm text-secondary">Preparing your account export…</p>}
                    {exportError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{exportError}</p>}
                    {exportMessage && <p role="status" className="text-sm text-secondary">{exportMessage}</p>}
                </div>

                <section aria-label="Import preview" className="ui-panel space-y-4">
                    <h3 className="font-semibold text-lg text-primary">Import preview</h3>
                    <p className="text-sm text-secondary">Previewing writes no account data. Select a JSON backup up to 5 MiB using Import Backup. Importing requires a separate confirmation.</p>
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">REPLACE removes your existing account data and creates the file’s data. Review the impact before opening the separate confirmation dialog.</p>
                    {previewing && <p role="status" className="text-sm text-secondary">Validating backup and calculating replacement impact…</p>}
                    {previewError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{previewError}</p>}
                    {preview && (
                        <div className="space-y-4 text-sm text-secondary">
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
                                            <tr key={key} className="border-t border-subtle">
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
                            <p className="text-xs text-secondary">This digest identifies the file only. It does not authorize an import.</p>
                        </div>
                    )}
                    <button
                        type="button"
                        disabled={!preview || previewing}
                        onClick={() => {
                            if (preview && Date.parse(preview.expires_at) > Date.now() && selectedPreviewFile) setConfirmationKind('import_replace');
                        }}
                        className="px-4 py-2 rounded-control bg-red-600 text-white disabled:opacity-50 font-semibold"
                    >
                        Review import confirmation
                    </button>
                </section>

                <section className="ui-panel border-red-200 dark:border-red-900/30 space-y-3">
                    <h3 className="font-semibold text-lg text-primary">Reset financial data</h3>
                    <p className="text-sm text-secondary">Reset deletes transactions, subscriptions, budget inputs and the currency preference. Your login account is kept. Review a fresh preview before confirming.</p>
                    <button type="button" onClick={() => setConfirmationKind('reset')} className="px-4 py-2.5 rounded-control bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-medium">Review account reset</button>
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
import { useAuth } from '../state/authStore';
import { useEffect, useRef, useState } from 'react';
import { getSessionEpoch } from '../api/authSession';
import { previewImportFile } from '../api/importPreview';
import type { ImportPreview, ResourceCounts } from '../api/importPreview';
import { checkDataOperationStatus, dispatchDataOperation, fetchResetPreview } from '../api/dataOperations';
import type { DataOperationKind, PendingDataOperation, ResetPreview } from '../api/dataOperations';

interface Props {
    kind: DataOperationKind;
    initialPreview?: ImportPreview | ResetPreview;
    initialFile?: File;
    recovery?: PendingDataOperation;
    onClose: () => void;
}
const resources: { key: keyof ResourceCounts; label: string }[] = [
    { key: 'transactions', label: 'Transactions' },
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'budget_profiles', label: 'Budget profile' },
    { key: 'preferences', label: 'Currency preference' },
];
const inputClass = 'w-full rounded-lg border border-control bg-surface dark:bg-canvas p-2 text-primary dark:text-primary';

export function DataConfirmationDialog({ kind, initialPreview, initialFile, recovery, onClose }: Props) {
    const [authorization, setAuthorization] = useState<ImportPreview | ResetPreview | null>(initialPreview || null);
    const [file, setFile] = useState<File | null>(initialFile || null);
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [operationKey] = useState(() => recovery?.key || crypto.randomUUID());
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const pending = useRef(false);
    const dialog = useRef<HTMLDialogElement | null>(null);
    const readController = useRef<AbortController | null>(null);
    const generation = useRef(0);
    const cancelBeforeDispatch = useRef(false);
    const requiredPhrase = kind === 'reset' ? 'RESET MY FINANCIAL DATA' : 'REPLACE MY FINANCIAL DATA';
    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => element?.close();
    }, []);
    useEffect(() => () => {
        generation.current += 1;
        readController.current?.abort();
        cancelBeforeDispatch.current = true;
    }, []);
    useEffect(() => {
        if (!authorization) return;
        const delay = Math.max(0, Date.parse(authorization.expires_at) - Date.now());
        const timer = setTimeout(() => {
            setAuthorization(null);
            setPassword('');
            setConfirmation('');
            setFile(null);
            setError('The preview expired. Request a fresh preview before confirming.');
        }, delay);
        return () => clearTimeout(timer);
    }, [authorization]);
    const loadPreview = async (selected?: File) => {
        if (pending.current) return;
        readController.current?.abort();
        const controller = new AbortController();
        readController.current = controller;
        const currentGeneration = ++generation.current;
        const epoch = getSessionEpoch();
        setWorking(true);
        setError('');
        setAuthorization(null);
        setPassword('');
        setConfirmation('');
        setFile(null);
        const current = () => !controller.signal.aborted && generation.current === currentGeneration && epoch === getSessionEpoch();
        try {
            const result = kind === 'reset'
                ? await fetchResetPreview(controller.signal)
                : await previewImportFile(selected!, controller.signal);
            if (!current()) return;
            if (recovery && kind === 'import_replace' && (result as ImportPreview).document_sha256 !== recovery.documentSha256) {
                setError('Select the same original file. A different backup cannot use this operation key.');
                return;
            }
            setAuthorization(result);
            setFile(selected || null);
        } catch (error) {
            if (current()) setError(error instanceof Error ? error.message : 'Unable to obtain a fresh preview.');
        } finally {
            if (current()) setWorking(false);
        }
    };
    const close = () => {
        cancelBeforeDispatch.current = true;
        generation.current += 1;
        readController.current?.abort();
        setPassword('');
        setConfirmation('');
        setAuthorization(null);
        setFile(null);
        onClose();
    };
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (pending.current || !authorization || !password || confirmation !== requiredPhrase) return;
        if (Date.parse(authorization.expires_at) <= Date.now()) {
            setAuthorization(null);
            setPassword('');
            setError('The preview expired. Request a fresh preview.');
            return;
        }
        pending.current = true;
        cancelBeforeDispatch.current = false;
        setWorking(true);
        setError('');
        const controller = new AbortController();
        readController.current = controller;
        const selected = file || undefined;
        const proof = authorization;
        const secret = password;
        const phrase = confirmation;
        setPassword('');
        setConfirmation('');
        setAuthorization(null);
        setFile(null);
        try {
            await dispatchDataOperation({
                kind, key: operationKey, previewToken: proof.preview_token, expiresAt: proof.expires_at,
                password: secret, confirmation: phrase, file: selected, preDispatchSignal: controller.signal,
                documentSha256: kind === 'import_replace' ? (proof as ImportPreview).document_sha256 : null,
            });
            if (!cancelBeforeDispatch.current) onClose();
        } catch (error) {
            if (!cancelBeforeDispatch.current) {
                setError(error instanceof Error ? error.message : 'Unable to start this operation. Request a fresh preview.');
                setWorking(false);
            }
        } finally {
            pending.current = false;
        }
    };
    return (
        <dialog
            ref={dialog}
            aria-labelledby="data-confirmation-title"
            onCancel={event => { event.preventDefault(); close(); }}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-modal bg-surface p-6 backdrop:bg-ink/60"
        >
            <section className="space-y-4">
                <h2 id="data-confirmation-title" className="font-sans text-xl font-bold text-primary">
                    {kind === 'reset' ? 'Confirm account reset' : 'Confirm account replacement'}
                </h2>
                <p className="text-sm text-red-700 dark:text-red-300">
                    {kind === 'reset' ? 'This will delete all financial records and reset your budget and currency preference.' : 'This will replace all financial records, budget inputs and currency preference with the backup.'}
                </p>
                <p className="text-sm text-secondary">Nothing changes until you explicitly confirm. Your login account and password are kept.</p>
                <p className="break-all text-sm text-secondary">Operation key: <code>{operationKey}</code></p>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Do not reload or close this tab after confirming. Recovery information is held only in memory and is lost on a full reload.</p>
                {recovery && <p className="text-sm text-amber-700 dark:text-amber-300">This retries the same unresolved operation key. Use the same original backup; a failed retry does not prove the earlier request failed.</p>}
                {kind === 'reset' ? (
                    <button type="button" disabled={working} onClick={() => { void loadPreview(); }} className="px-4 py-2 rounded-control border dark:border-control text-secondary">Request fresh reset preview</button>
                ) : (!authorization && !working) && (
                    <label className="block text-sm text-secondary">
                        {recovery ? 'Select the same original JSON backup' : 'Select JSON backup for a fresh preview'}
                        <input type="file" accept=".json,application/json" onChange={event => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (selected) void loadPreview(selected); }} className="block mt-2" />
                    </label>
                )}
                {working && <p role="status" className="text-sm text-secondary">Preparing or submitting your operation…</p>}
                {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
                {authorization && (
                    <div className="space-y-3 text-sm text-secondary">
                        <p>Preview expires: {authorization.expires_at}</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <caption className="text-left font-semibold mb-2">Replacement impact</caption>
                                <thead><tr><th scope="col">Data</th><th scope="col">Would remove</th><th scope="col">Would create</th></tr></thead>
                                <tbody>{resources.map(({ key, label }) => <tr key={key}><th scope="row" className="py-1 font-medium">{label}</th><td>{authorization.replacement_impact.would_remove[key]}</td><td>{authorization.replacement_impact.would_create[key]}</td></tr>)}</tbody>
                            </table>
                        </div>
                        <ul className="list-disc pl-5">{authorization.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul>
                        {kind === 'import_replace' && <p className="break-all">File SHA-256: <code>{(authorization as ImportPreview).document_sha256}</code></p>}
                    </div>
                )}
                <form onSubmit={submit} className="space-y-4">
                    <label className="block text-sm text-secondary">Current password
                        <input type="password" autoComplete="current-password" required disabled={!authorization || working} value={password} onChange={event => setPassword(event.target.value)} className={inputClass} />
                    </label>
                    <label className="block text-sm text-secondary">Type {requiredPhrase}
                        <input type="text" autoComplete="off" required disabled={!authorization || working} value={confirmation} onChange={event => setConfirmation(event.target.value)} className={inputClass} />
                    </label>
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={close} className="px-4 py-2 text-secondary">Cancel before confirmation</button>
                        <button type="submit" disabled={!authorization || working || !password || confirmation !== requiredPhrase} className="rounded-control bg-red-600 px-4 py-2 text-white disabled:opacity-50 font-semibold">
                            {recovery ? 'Retry this same operation' : kind === 'reset' ? 'Reset my financial data' : 'Replace my financial data'}
                        </button>
                    </div>
                </form>
            </section>
        </dialog>
    );
}

export function DataOperationGate({ operation }: { operation: PendingDataOperation }) {
    const { logout } = useAuth();
    const [checking, setChecking] = useState(false);
    const [recovering, setRecovering] = useState(false);
    const [message, setMessage] = useState('');
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const check = async () => {
        if (checking) return;
        setChecking(true);
        try {
            const result = await checkDataOperationStatus();
            if (mounted.current && result === 'unknown') setMessage('No matching completion receipt is available yet. The outcome remains unknown.');
        } catch {
            if (mounted.current) setMessage('Unable to check the receipt. The operation remains unresolved.');
        } finally {
            if (mounted.current) setChecking(false);
        }
    };
    return (
        <main className="min-h-screen bg-canvas flex items-center justify-center p-6">
            <section className="max-w-xl rounded-modal bg-surface border border-amber-200 p-6 space-y-4">
                <h1 className="font-sans text-2xl font-bold text-primary">Account data operation unresolved</h1>
                <p className="text-secondary">Financial pages and new writes are paused until a matching completion receipt is confirmed. A missing receipt does not mean failure.</p>
                <p className="break-all text-sm text-secondary">Operation key: <code>{operation.key}</code></p>
                <p className="text-sm text-amber-700 dark:text-amber-300">Do not reload or close this tab. This recovery key is kept only in memory. Canceling a request cannot undo a server operation.</p>
                {message && <p role="status" className="text-sm text-secondary">{message}</p>}
                <div className="flex flex-wrap gap-3">
                    <button type="button" disabled={checking} onClick={() => { void check(); }} className="rounded-control bg-accent px-4 py-2 text-accent-ink font-semibold">{checking ? 'Checking status…' : 'Check operation status'}</button>
                    {operation.status === 'unknown' && <button type="button" onClick={() => setRecovering(true)} className="rounded-control border px-4 py-2 text-secondary">Prepare same-key recovery</button>}
                </div>
                <button type="button" onClick={() => { void logout().catch(() => {}); }} className="text-sm underline text-secondary">Sign out — keep the recovery key in this tab</button>
                {recovering && <DataConfirmationDialog kind={operation.kind} recovery={operation} onClose={() => setRecovering(false)} />}
            </section>
        </main>
    );
}

import SelectControl from "../SelectControl";
import { UnknownWriteOutcomeError } from "../../api/client";
import { localDate } from "../../utils/dates";
import { useId, useRef, useState } from "react";
import { useMoneyDraft } from "../../hooks/useMoneyDraft";
import AmountInput from "../AmountInput";
import { X } from "lucide-react";
import type { Subscription } from "../../types/finance";
import { useSettings, CURRENCY_SYMBOLS } from "../../hooks/useSettings";

interface SubscriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (subscription: Omit<Subscription, 'id' | 'icon'>) => Promise<void>;
    initialData?: Subscription | null;
}

function SubscriptionModal({ isOpen, onClose, onSubmit, initialData }: SubscriptionModalProps){

    const settings = useSettings();
    const draft = useMoneyDraft(settings, initialData ? { amount: initialData.amount } : {}, ['amount']);
    const fieldId = useId();
    const amountRef = useRef<HTMLInputElement>(null);
    const [saving, setSaving] = useState(false);
    const [unknownOutcome, setUnknownOutcome] = useState(false);
    const [error, setError] = useState('');
    const submitting = useRef(false);
    const [amountInvalid, setAmountInvalid] = useState(false);

    // Initialize state directly from initialData (if it exists)
    const [serviceName, setServiceName] = useState(initialData?.serviceName || '');
    
    const [nextPaymentDate, setNextPaymentDate] = useState(
        initialData?.nextPaymentDate || localDate()
    );

    const [status, setStatus] = useState<'active' | 'paused'>(initialData?.status || 'active');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting.current || unknownOutcome) return;
        submitting.current = true; setSaving(true); setError('');
        try {
        if (!serviceName.trim() || !draft.values.amount || !nextPaymentDate) throw new Error('Service name, amount and payment date are required.');
        let amount: string;
        try { amount = draft.resolve('amount'); }
        catch (error) { setAmountInvalid(true); amountRef.current?.focus(); throw error; }

        await onSubmit({serviceName,amount,nextPaymentDate,status});
        onClose();
        } catch (error) { setError(error instanceof Error ? error.message : 'Save failed. Please retry.'); if (error instanceof UnknownWriteOutcomeError) { setUnknownOutcome(true); settings.refresh(); } }
        finally { submitting.current = false; setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50">
            <div className="bg-surface rounded-modal max-h-[90dvh] overflow-y-auto w-full max-w-md shadow-overlay transition-colors">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-subtle">
                    <h2 className="font-sans text-xl font-bold text-primary">
                        {initialData ? 'Edit Subscription' : 'Add Subscription'}
                    </h2>
                    <button
                        onClick={onClose} disabled={saving} aria-label="Close subscription"
                        className="p-2 rounded-control hover:bg-hover dark:hover:bg-hover text-secondary transition-colors cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>

                    {/* Modal Body / Form */}
                    <form onSubmit={handleSubmit} className="p-6 space-y-4">
                        {draft.warning && <p id={`${fieldId}-rate-warning`} role="status" className="text-sm text-secondary">{draft.warning}</p>}
                        {error && <p id={`${fieldId}-error`} role="alert" className="text-red-500 text-sm">{error}</p>}
                    {unknownOutcome && <button type="button" className="text-accent underline text-sm" onClick={() => {setUnknownOutcome(false); setError('');}}>I checked saved records; allow another save</button>}
                        <div>
                            <label htmlFor={`${fieldId}-service`} className="block text-sm font-medium text-secondary mb-1.5">
                            Service Name
                            </label>
                            <input
                                id={`${fieldId}-service`}
                                type="text"
                                required
                                placeholder="e.g., Netflix, Spotify"
                                value={serviceName}
                                onChange={(e) => setServiceName(e.target.value)}
                                className="w-full px-4 py-2.5 bg-canvas border border-control rounded-control focus:outline-none focus:ring-2 focus:ring-accent/20 text-primary transition-colors"
                            />
                        </div>

                        <div>
                            <label htmlFor={`${fieldId}-amount`} className="block text-sm font-medium text-secondary mb-1.5">
                            Monthly Amount ({draft.currency})
                            </label>
                                <AmountInput
                                    id={`${fieldId}-amount`}
                                    ref={amountRef}
                                    currency={draft.currency}
                                    symbol={CURRENCY_SYMBOLS[draft.currency]}
                                    aria-invalid={amountInvalid}
                                    aria-describedby={[draft.warning && `${fieldId}-rate-warning`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined}
                                    required
                                    placeholder="0.00"
                                    value={draft.values.amount}
                                    onChange={(e) => { draft.setValue('amount', e.target.value); setAmountInvalid(false); }}
                                />
                        </div>

                        <div>
                            <label htmlFor={`${fieldId}-date`} className="block text-sm font-medium text-secondary mb-1.5">
                            Next Payment Date
                            </label>
                            <input
                                id={`${fieldId}-date`}
                                type="date"
                                required
                                value={nextPaymentDate}
                                onChange={(e) => setNextPaymentDate(e.target.value)}
                                className="w-full px-4 py-2.5 bg-canvas border border-control rounded-control focus:outline-none focus:ring-2 focus:ring-accent/20 text-primary transition-colors"
                            />
                        </div>

                        <div>
                            <label htmlFor={`${fieldId}-status`} className="block text-sm font-medium text-secondary mb-1.5">
                            Status
                            </label>
                            <SelectControl
                                id={`${fieldId}-status`}
                                containerClassName="w-full"
                                aria-label="Subscription status"
                                value={status}
                                onChange={(e) => setStatus(e.target.value as 'active' | 'paused')}
                                className="w-full px-4 py-2.5 bg-canvas border border-control rounded-control focus:outline-none focus:ring-2 focus:ring-accent/20 text-primary transition-colors font-medium"
                            >
                                <option value="active">Active</option>
                                <option value="paused">Paused</option>
                            </SelectControl>
                        </div>

                        {/* Form Actions */}
                        <div className="flex items-center justify-end gap-3 pt-4">
                            <button
                                type="button"
                                onClick={onClose} disabled={saving}
                                className="px-4 py-2.5 text-sm font-medium text-secondary hover:bg-hover dark:hover:bg-hover rounded-control transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                            disabled={saving || unknownOutcome}
                                className="px-4 py-2.5 text-sm font-semibold text-accent-ink bg-accent hover:bg-accent-hover rounded-control transition-colors shadow-none cursor-pointer"
                            >
                                {initialData ? 'Save Changes' : 'Add Subscription'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        );
}
export default SubscriptionModal

import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { BudgetRecord } from '../../api/client';
import { useSettings, CURRENCY_SYMBOLS } from '../../hooks/useSettings';
import { useMoneyDraft } from '../../hooks/useMoneyDraft';
import AmountInput from '../AmountInput';
interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (patch: Partial<BudgetRecord>) => Promise<void>;
    currentBudget: BudgetRecord;
}
const fields = [
    ['monthly_income_usd', 'Monthly Income'],
    ['needs_spent_usd', 'Needs spent'],
    ['wants_spent_usd', 'Wants spent'],
    ['savings_usd', 'Savings'],
] as const;
const keys = fields.map(([key]) => key);
export default function BudgetModal({ isOpen, onClose, onSubmit, currentBudget }: Props) {
    const settings = useSettings();
    const draft = useMoneyDraft(settings, currentBudget, keys);
    const fieldId = useId();
    const inputs = useRef<Partial<Record<keyof BudgetRecord, HTMLInputElement>>>({});
    const [invalidField, setInvalidField] = useState<keyof BudgetRecord | null>(null);
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);
    const [error, setError] = useState('');
    if (!isOpen) {
        return null;
    }
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (pending.current) {
            return;
        }
        pending.current = true;
        setSaving(true);
        setError('');
        try {
            const patch: Partial<BudgetRecord> = {};
            for (const [key] of fields) {
                if (draft.changed(key)) {
                    try { patch[key] = draft.resolve(key); }
                    catch (error) { setInvalidField(key); inputs.current[key]?.focus(); throw error; }
                }
            }
            if (Object.keys(patch).length) {
                await onSubmit(patch);
            }
            onClose();
        }
        catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to save budget.');
        }
        finally {
            pending.current = false;
            setSaving(false);
        }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50">
            <div className="bg-surface rounded-modal max-h-[90dvh] overflow-y-auto w-full max-w-md shadow-overlay p-6">
                <div className="flex justify-between mb-4">
                    <h2 className="font-sans text-xl font-bold text-primary">Set Budget</h2>
                    <button disabled={saving} onClick={onClose} aria-label="Close budget">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={submit} className="space-y-4">
                    <p className="text-sm text-secondary">
                        These manual budget inputs are independent of transaction totals.
                        Currency: {draft.currency} ({CURRENCY_SYMBOLS[draft.currency]}).
                    </p>
                    {draft.warning && <p id={`${fieldId}-rate-warning`} role="status" className="text-sm text-secondary">{draft.warning}</p>}
                    {error && <p id={`${fieldId}-error`} role="alert" className="text-red-500">{error}</p>}
                    {fields.map(([key, label]) => (
                        <div key={key} className="text-sm text-secondary">
                            <label htmlFor={`${fieldId}-${key}`} className="mb-1 block">{label}</label>
                            <AmountInput
                                id={`${fieldId}-${key}`}
                                ref={element => { if (element) inputs.current[key] = element; else delete inputs.current[key]; }}
                                currency={draft.currency}
                                symbol={CURRENCY_SYMBOLS[draft.currency]}
                                aria-label={label}
                                aria-invalid={invalidField === key}
                                aria-describedby={[draft.warning && `${fieldId}-rate-warning`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined}
                                required
                                value={draft.values[key]}
                                onChange={e => {
                                    draft.setValue(key, e.target.value);
                                    setInvalidField(null);
                                }}
                            />
                        </div>
                    ))}
                    <div className="flex justify-end gap-4">
                        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 rounded-control bg-accent text-accent-ink font-semibold"
                        >
                            {saving ? 'Saving…' : 'Save Budget'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

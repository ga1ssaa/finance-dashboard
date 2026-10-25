import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { BudgetRecord } from '../../api/client';
import { useSettings, CURRENCY_SYMBOLS } from '../../hooks/useSettings';
import { fromUSD, toUSD } from '../../utils/money';
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
export default function BudgetModal({ isOpen, onClose, onSubmit, currentBudget }: Props) {
    const settings = useSettings();
    const [currency] = useState(settings.currency);
    const [rate] = useState(String(settings.rates[settings.currency]));
    const [values, setValues] = useState(() => Object.fromEntries(fields.map(([key]) => [key, fromUSD(currentBudget[key], rate)])) as Record<keyof BudgetRecord, string>);
    const [dirty, setDirty] = useState<Partial<Record<keyof BudgetRecord, boolean>>>({});
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
                if (dirty[key]) {
                    patch[key] = toUSD(values[key], rate);
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
                        Currency: {currency} ({CURRENCY_SYMBOLS[currency]}).
                    </p>
                    {error && <p role="alert" className="text-red-500">{error}</p>}
                    {fields.map(([key, label]) => (
                        <label key={key} className="block text-sm text-secondary">
                            {label}
                            <input
                                aria-label={label}
                                required
                                inputMode="decimal"
                                value={values[key]}
                                onChange={e => {
                                    setValues({ ...values, [key]: e.target.value });
                                    setDirty({ ...dirty, [key]: true });
                                }}
                                className="w-full px-4 py-2 mt-1 rounded-control border dark:border-control dark:bg-canvas"
                            />
                        </label>
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

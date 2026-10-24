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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-xl p-6">
                <div className="flex justify-between mb-4">
                    <h2 className="font-serif text-xl font-bold text-slate-800 dark:text-white">Set Budget</h2>
                    <button disabled={saving} onClick={onClose} aria-label="Close budget">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={submit} className="space-y-4">
                    <p className="text-sm text-slate-500">
                        These manual budget inputs are independent of transaction totals.
                        Currency: {currency} ({CURRENCY_SYMBOLS[currency]}).
                    </p>
                    {error && <p role="alert" className="text-red-500">{error}</p>}
                    {fields.map(([key, label]) => (
                        <label key={key} className="block text-sm text-slate-700 dark:text-slate-300">
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
                                className="w-full px-4 py-2 mt-1 rounded-lg border dark:border-slate-700 dark:bg-slate-900"
                            />
                        </label>
                    ))}
                    <div className="flex justify-end gap-4">
                        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 rounded-xl bg-blue-600 text-white"
                        >
                            {saving ? 'Saving…' : 'Save Budget'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

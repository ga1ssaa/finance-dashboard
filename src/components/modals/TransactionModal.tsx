import { UnknownWriteOutcomeError } from "../../api/client";
import { localDate } from "../../utils/dates";
import { useRef, useState } from "react";
import { fromUSD, toUSD, units } from "../../utils/money";
import { X } from "lucide-react";
import type { Transaction, CategoryType } from "../../types/finance";
import { useSettings, CURRENCY_SYMBOLS } from "../../hooks/useSettings";

interface TransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (transaction: Transaction) => Promise<void>;
    initialData?: Transaction | null;
}

function TransactionModal({ isOpen, onClose, onSubmit, initialData }: TransactionModalProps) {

    const settings = useSettings();
    const [currency] = useState(settings.currency);
    const [rate] = useState(String(settings.rates[settings.currency]));
    const [saving, setSaving] = useState(false);
    const [unknownOutcome, setUnknownOutcome] = useState(false);
    const [error, setError] = useState('');
    const submitting = useRef(false);
    const [amountDirty, setAmountDirty] = useState(false);
    
    const [title, setTitle] = useState(initialData?.title || '');
    const [amount, setAmount] = useState(() => {
        if (!initialData?.amount) return '';
        return fromUSD(initialData.amount, rate);
    });
    const [date, setDate] = useState(initialData?.date || localDate());
    const [type, setType] = useState<'income' | 'expense'>(initialData?.type || 'expense');
    const [category, setCategory] = useState<CategoryType | ''>((initialData?.category as CategoryType) || '');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting.current || unknownOutcome) return;
        submitting.current = true; setSaving(true); setError('');
        try {

        if (!title.trim() || !amount || !category.trim()) throw new Error('Title, amount and category are required.');
        const canonical = initialData && !amountDirty ? initialData.amount : toUSD(amount, rate);
        if (units(canonical) <= 0n) throw new Error('Amount must be greater than zero.');

        const transactionToSave: Transaction = {
            id: (initialData ? initialData.id : crypto.randomUUID()) as Transaction['id'],
            title,
            amount: canonical,
            type,
            category: category as Transaction['category'],
            date,
        };

        await onSubmit(transactionToSave);
        onClose();
        } catch (error) { setError(error instanceof Error ? error.message : 'Save failed. Please retry.'); if (error instanceof UnknownWriteOutcomeError) { setUnknownOutcome(true); settings.refresh(); } }
        finally { submitting.current = false; setSaving(false); }
    };

    const isEdit = Boolean(initialData);

    return (
        <div className="fixed inset-0 bg-slate-900/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-colors">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl border border-slate-100 dark:border-slate-700 transition-colors duration-200">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-xl font-bold text-slate-800 dark:text-white transition-colors">
                        {isEdit ? "Edit Transaction" : "New Transaction"}
                    </h3>
                    <button
                        onClick={onClose} disabled={saving}
                        className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
                    {unknownOutcome && <button type="button" className="text-blue-600 underline text-sm" onClick={() => {setUnknownOutcome(false); setError('');}}>I checked saved records; allow another save</button>}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 font-serif transition-colors">
                            Title
                        </label>
                        <input
                            type="text"
                            placeholder="e.g., Grocery Shopping"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-4 py-2 bg-transparent dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 font-serif transition-colors">
                                Amount 
                            </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-slate-400 font-bold select-none">
                                        {CURRENCY_SYMBOLS[currency]} 
                                    </span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => { setAmount(e.target.value); setAmountDirty(true); }}
                                        className="w-full pl-8 pr-4 py-2 bg-transparent dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                                />
                                </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 font-serif transition-colors">
                                Type
                            </label>
                            <select
                                value={type}
                                    onChange={(e) => setType(e.target.value as 'income' | 'expense')}
                                    className="w-full px-4 py-2 bg-transparent dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 dark:text-white transition-colors cursor-pointer"
                            >
                                <option value="expense" className="dark:bg-slate-800">Expense</option>
                                <option value="income" className="dark:bg-slate-800">Income</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 font-serif transition-colors">
                            Category
                        </label>
                        <input
                            type="text"
                            placeholder="Food, Rent, Salary..."
                            value={category}
                            onChange={(e) => setCategory(e.target.value as CategoryType)}
                            className="w-full px-4 py-2 bg-transparent dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                        />
                    </div>

                    <label className="block text-sm text-slate-700 dark:text-slate-300">Date<input aria-label="Transaction date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full p-2 rounded-lg border dark:bg-slate-900 dark:border-slate-700" /></label>
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose} disabled={saving}
                            className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer transition-colors font-medium font-serif"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving || unknownOutcome}
                            className="flex-1 px-4 py-2 border border-transparent rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer transition-colors font-medium font-serif"
                        >
                            {isEdit ? "Save Changes" : "Add"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default TransactionModal;
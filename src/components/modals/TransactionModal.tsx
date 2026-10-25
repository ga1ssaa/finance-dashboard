import SelectControl from "../SelectControl";
import AmountInput from "../AmountInput";
import { UnknownWriteOutcomeError } from "../../api/client";
import { localDate } from "../../utils/dates";
import { useEffect, useId, useRef, useState } from "react";
import { fromUSD, normalizeMoneyInput, sameDecimalAmount, toUSD, units, validateExchangeRate } from "../../utils/money";
import { freshRate } from "../../utils/exchangeRates";
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
    const fieldId = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (!isOpen) return;
        const dialog = dialogRef.current;
        const previousFocus = document.activeElement;
        dialog?.showModal();
        return () => {
            if (dialog?.open) dialog.close();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        };
    }, [isOpen]);
    const [quote] = useState(() => {
        const sourceCurrency = settings.currency;
        try {
            const rate = sourceCurrency === 'USD' ? '1' : validateExchangeRate(settings.rates[sourceCurrency]);
            let warning = '';
            try { freshRate(sourceCurrency, { [sourceCurrency]: rate }, settings.ratesUpdatedAt); }
            catch (error) { warning = error instanceof Error ? error.message : 'Exchange rate unavailable.'; }
            return { currency: sourceCurrency, sourceCurrency, rate, publishedAt: settings.ratesUpdatedAt, initialAmount: initialData ? fromUSD(initialData.amount, rate) : '', warning };
        } catch {
            return { currency: initialData ? 'USD' as const : sourceCurrency, sourceCurrency, rate: null, publishedAt: null, initialAmount: initialData?.amount || '', warning: initialData ? 'Exchange rate unavailable. The original amount is shown in USD; only non-amount edits can be saved. Choose USD and reopen to change it.' : 'Exchange rate unavailable. Choose USD or retry loading rates and reopen this form.' };
        }
    });
    const currency = quote.currency;
    const [saving, setSaving] = useState(false);
    const [unknownOutcome, setUnknownOutcome] = useState(false);
    const [error, setError] = useState('');
    const submitting = useRef(false);
    const [amountInvalid, setAmountInvalid] = useState(false);
    
    const [title, setTitle] = useState(initialData?.title || '');
    const [amount, setAmount] = useState(quote.initialAmount);
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
        let canonical: string;
        setAmountInvalid(false);
        try {
            if (initialData && sameDecimalAmount(amount, quote.initialAmount)) canonical = initialData.amount;
            else {
                if (!quote.rate) throw new Error(quote.warning);
                const rate = freshRate(quote.sourceCurrency, { [quote.sourceCurrency]: quote.rate }, quote.publishedAt);
                canonical = quote.sourceCurrency === 'USD' ? normalizeMoneyInput(amount) : toUSD(amount, rate, 'half-even');
            }
            if (units(canonical) <= 0n) throw new Error(sameDecimalAmount(amount, '0') ? 'Amount must be greater than zero.' : 'Amount rounds below the minimum 0.00000001 USD.');
        } catch (error) { setAmountInvalid(true); throw error; }

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
        <dialog ref={dialogRef} aria-labelledby={`${fieldId}-heading`} onCancel={event => { if (saving) event.preventDefault(); else onClose(); }} onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'));
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none items-center justify-center border-0 bg-transparent p-4 text-primary backdrop:bg-ink/50 dark:backdrop:bg-ink/80 open:flex">
            <div className="bg-surface rounded-modal max-h-[90dvh] overflow-y-auto w-full max-w-md p-6 shadow-overlay border border-subtle transition-colors duration-200">
                <div className="flex items-center justify-between mb-4">
                    <h3 id={`${fieldId}-heading`} className="font-sans text-xl font-bold text-primary transition-colors">
                        {isEdit ? "Edit Transaction" : "New Transaction"}
                    </h3>
                    <button
                        onClick={onClose} disabled={saving} aria-label="Close transaction"
                        className="text-secondary hover:text-secondary dark:hover:text-secondary transition-colors cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {quote.warning && <p id={`${fieldId}-rate-warning`} role="status" className="text-sm text-secondary">{quote.warning}</p>}
                    {error && <p id={`${fieldId}-error`} role="alert" className="text-red-500 text-sm">{error}</p>}
                    {unknownOutcome && <button type="button" className="text-accent underline text-sm" onClick={() => {setUnknownOutcome(false); setError('');}}>I checked saved records; allow another save</button>}
                    <div>
                        <label htmlFor={`${fieldId}-title`} className="block text-sm font-medium text-secondary mb-1 font-sans transition-colors">
                            Title
                        </label>
                        <input
                            id={`${fieldId}-title`}
                            type="text"
                            placeholder="e.g., Grocery Shopping"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-4 py-2 bg-transparent dark:bg-canvas border border-control rounded-control focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent text-primary placeholder:text-secondary dark:placeholder:text-secondary transition-colors"
                        />
                    </div>

                    <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor={`${fieldId}-amount`} className="block text-sm font-medium text-secondary mb-1">Amount ({currency})</label>
                            <AmountInput
                                id={`${fieldId}-amount`}
                                currency={currency}
                                symbol={CURRENCY_SYMBOLS[currency]}
                                placeholder="0.00"
                                value={amount}
                                aria-invalid={amountInvalid}
                                aria-describedby={[quote.warning && `${fieldId}-rate-warning`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined}
                                onChange={e => { setAmount(e.target.value); setAmountInvalid(false); }}
                            />
                        </div>

                        <div>
                            <label htmlFor={`${fieldId}-type`} className="block text-sm font-medium text-secondary mb-1 font-sans transition-colors">
                                Type
                            </label>
                            <SelectControl
                                id={`${fieldId}-type`}
                                containerClassName="w-full"
                                aria-label="Transaction type"
                                value={type}
                                onChange={(e) => setType(e.target.value as 'income' | 'expense')}
                                className="w-full px-4 py-2 bg-transparent dark:bg-canvas border border-control rounded-control focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent text-primary transition-colors cursor-pointer font-medium"
                            >
                                <option value="expense" className="dark:bg-surface">Expense</option>
                                <option value="income" className="dark:bg-surface">Income</option>
                            </SelectControl>
                        </div>
                    </div>

                    <div>
                        <label htmlFor={`${fieldId}-category`} className="block text-sm font-medium text-secondary mb-1 font-sans transition-colors">
                            Category
                        </label>
                        <input
                            type="text"
                            id={`${fieldId}-category`}
                            placeholder="Food, Rent, Salary..."
                            value={category}
                            onChange={(e) => setCategory(e.target.value as CategoryType)}
                            className="w-full px-4 py-2 bg-transparent dark:bg-canvas border border-control rounded-control focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent text-primary placeholder:text-secondary dark:placeholder:text-secondary transition-colors"
                        />
                    </div>

                    <label className="block text-sm text-secondary">Date<input aria-label="Transaction date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full p-2 rounded-control border dark:bg-canvas dark:border-control" /></label>
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose} disabled={saving}
                            className="flex-1 px-4 py-2 border border-subtle rounded-control bg-muted dark:bg-surface text-secondary hover:bg-hover dark:hover:bg-hover cursor-pointer transition-colors font-medium font-sans"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving || unknownOutcome}
                            className="flex-1 px-4 py-2 border border-transparent rounded-control bg-accent hover:bg-accent-hover text-accent-ink cursor-pointer transition-colors font-semibold font-sans"
                        >
                            {isEdit ? "Save Changes" : "Add"}
                        </button>
                    </div>
                </form>
            </div>
        </dialog>
    );
}

export default TransactionModal;

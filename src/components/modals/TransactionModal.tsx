import { useState } from "react";
import { X } from "lucide-react";
import type { Transaction, CategoryType } from "../../types/finance";
import { useSettings, CURRENCY_SYMBOLS } from "../../hooks/useSettings";

interface TransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (transaction: Transaction) => void;
    initialData?: Transaction | null;
}

function TransactionModal({ isOpen, onClose, onSubmit, initialData }: TransactionModalProps) {

    const {currency, convertAmount, toBaseCurrency} = useSettings();
    
    const [title, setTitle] = useState(initialData?.title || '');
    const [amount, setAmount] = useState(() => {
        if (!initialData?.amount) return '';
        const converted = convertAmount(initialData.amount);
        return currency === 'KZT' || currency === 'RUB' 
            ? Math.round(converted).toString() 
            : converted.toFixed(2);
    });
    const [type, setType] = useState<'income' | 'expense'>(initialData?.type || 'expense');
    const [category, setCategory] = useState<CategoryType | ''>((initialData?.category as CategoryType) || '');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!title || !amount || Number(amount) <= 0 || !category) return;

        const transactionToSave: Transaction = {
            id: (initialData ? initialData.id : crypto.randomUUID()) as Transaction['id'],
            title,
            amount: toBaseCurrency(Number(amount)),
            type,
            category: category as Transaction['category'],
            date: initialData ? initialData.date : new Date().toISOString().split('T')[0],
        };

        onSubmit(transactionToSave);
        onClose();
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
                        onClick={onClose}
                        className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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
                                        type="number"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
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

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer transition-colors font-medium font-serif"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
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
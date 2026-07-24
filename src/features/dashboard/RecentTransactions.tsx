import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Trash2, Filter, ArrowUpDown, Pencil } from "lucide-react";
import type { Transaction } from "../../types/finance";

interface RecentTransactionsProps {
    transactions: Transaction[];
    onDeleteTransaction: (id: string | number) => void;
    onEditTransaction: (transaction: Transaction) => void;
}

type FilterType = 'all' | 'income' | 'expense';
type SortType = 'date-asc' | 'date-desc' | 'amount-asc' | 'amount-desc';

function RecentTransactions({ transactions, onDeleteTransaction, onEditTransaction }: RecentTransactionsProps) {
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [sortBy, setSortBy] = useState<SortType>('date-desc');

    const filteredTransactions = transactions.filter((tx) => {
        if (filterType === 'all') return true;
        return tx.type === filterType;
    });

    const displayTransactions = [...filteredTransactions].sort((a, b) => {
        if (sortBy === 'date-desc') {
            return new Date(b.date).getTime() - new Date(a.date).getTime();
        }
        if (sortBy === 'date-asc') {
            return new Date(a.date).getTime() - new Date(b.date).getTime();
        }
        if (sortBy === 'amount-desc') {
            return b.amount - a.amount;
        }
        if (sortBy === 'amount-asc') {
            return a.amount - b.amount;
        }
        return 0;
    });

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm h-80 flex flex-col transition-colors duration-200">
            <div className="flex items-center justify-between mb-4 gap-2">
                <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-white transition-colors">
                    Recent Transactions
                </h3>

                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs transition-colors">
                        <Filter size={14} className="text-slate-400 dark:text-slate-500" />
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value as FilterType)}
                            className="bg-transparent focus:outline-none text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
                        >
                            <option value="all" className="dark:bg-slate-800">All</option>
                            <option value="income" className="dark:bg-slate-800">Income</option>
                            <option value="expense" className="dark:bg-slate-800">Expense</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs transition-colors">
                        <ArrowUpDown size={14} className="text-slate-400 dark:text-slate-500" />
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortType)}
                            className="bg-transparent focus:outline-none text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
                        >
                            <option value="date-desc" className="dark:bg-slate-800">Newest First</option>
                            <option value="date-asc" className="dark:bg-slate-800">Oldest First</option>
                            <option value="amount-desc" className="dark:bg-slate-800">Highest Amount</option>
                            <option value="amount-asc" className="dark:bg-slate-800">Lowest Amount</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {displayTransactions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 text-sm">
                        No Transaction Found
                    </div>
                ) : (
                    displayTransactions.map((transaction) => (
                        <div
                            key={transaction.id}
                            className="group flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                        >
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                    transaction.type === 'income'
                                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                                }`}>
                                    {transaction.type === 'income' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                                </div>

                                <div>
                                    <p className="font-serif font-medium text-slate-800 dark:text-white">{transaction.title}</p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">{transaction.category} • {transaction.date}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className={`font-bold ${
                                    transaction.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'
                                }`}>
                                    {transaction.type === 'income' ? '+' : '-'}${transaction.amount}
                                </div>
                                
                                {/* Edit action button */}
                                <button
                                    onClick={() => onEditTransaction(transaction)}
                                    className="text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                    title="Edit transaction"
                                >
                                    <Pencil size={18} />
                                </button>

                                {/* Delete action button */}
                                <button
                                    onClick={() => onDeleteTransaction(transaction.id)}
                                    className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                    title="Delete transaction"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default RecentTransactions;
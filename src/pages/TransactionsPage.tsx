import { useState, useMemo } from "react";
import { Search, Plus, Sun, Moon } from "lucide-react";
import type { Transaction } from "../types/finance";
import TransactionItem from "../components/TransactionItem";
import TransactionFilters from "../components/TransactionFilters";
import type { FilterType, SortType } from "../components/TransactionFilters";

interface TransactionsPageProps {
    transactions: Transaction[];
    onDeleteTransaction: (id: string | number) => void;
    onEditTransaction: (transaction: Transaction) => void;
    onOpenAddModal: () => void;
    isDarkMode?: boolean;
    toggleTheme?: () => void;
}

function TransactionsPage({transactions, onDeleteTransaction, onEditTransaction, onOpenAddModal, isDarkMode, toggleTheme}: TransactionsPageProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [sortBy, setSortBy] = useState<SortType>('date-desc');

    const processedTransactions = useMemo(() => {
        return transactions
        .filter((tx) => {
            const matchesSearch = tx.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                tx.category.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesType = filterType === 'all' || tx.type === filterType;
            return matchesSearch && matchesType;
        })
        .sort((a, b) => {
            if (sortBy === 'date-desc') return new Date(b.date).getTime() - new Date(a.date).getTime();
            if (sortBy === 'date-asc') return new Date(a.date).getTime() - new Date(b.date).getTime();
            if (sortBy === 'amount-desc') return b.amount - a.amount;
            if (sortBy === 'amount-asc') return a.amount - b.amount;
            return 0;
        });
    }, [transactions, searchTerm, filterType, sortBy]);

    return (
            <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                    All Transactions
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                    Manage and search your complete history
                </p>
                </div>

                <div className="flex items-center gap-3">
                {toggleTheme && (
                    <button
                        onClick={toggleTheme}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer"
                        title="Toggle Dark Mode"
                    >
                        {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                )}

                <button
                    onClick={onOpenAddModal}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm cursor-pointer transition-colors w-fit"
                >
                    <Plus size={18} />
                    <span>Add Transaction</span>
                </button>
                </div>
            </div>

            {/* Search Bar + Filters */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between transition-colors">
                <div className="relative w-full md:w-80">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by title or category..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                />
                </div>

                <TransactionFilters
                    filterType={filterType}
                    setFilterType={setFilterType}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                />
            </div>

        {/* Full List */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm transition-colors space-y-2">
                {processedTransactions.length === 0 ? (
                <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
                    No transactions found.
                </div>
                ) : (
                processedTransactions.map((tx) => (
                    <TransactionItem
                        key={tx.id}
                        transaction={tx}
                        onDelete={onDeleteTransaction}
                        onEdit={onEditTransaction}
                    />
                    ))
                )}
            </div>
        </div>
    );
}
export default TransactionsPage;
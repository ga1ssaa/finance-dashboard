import DashboardLayout from "./components/DashboardLayout";
import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import RecentTransactions from "./features/dashboard/RecentTransactions";
import TransactionModal from "./features/dashboard/TransactionModal";
import {UseTheme} from "./hooks/UseTheme";
import type { TimeRange } from "./hooks/UseTransactions";
import {UseTransactions} from "./hooks/UseTransactions";
import { Plus, Moon, Sun } from "lucide-react";

function App() {
    // Custom hooks for theme and transaction logic
    const { isDarkMode, toggleTheme } = UseTheme();
    const {
        filteredTransactions,
        timeRange,
        setTimeRange,
        isModalOpen,
        setIsModalOpen,
        editingTransaction,
        setEditingTransaction,
        handleAddTransaction,
        handleUpdateTransaction,
        handleDeleteTransaction,
    } = UseTransactions();

    return (
        <DashboardLayout>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                        Financial Overview
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                        Track your income and expenses
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Dark / Light mode toggle */}
                    <button
                        onClick={toggleTheme}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer"
                        title="Toggle Dark Mode"
                    >
                        {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                
                    {/* Add new transaction button */}
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 hover:scale-105 text-white px-4 py-2.5 rounded-xl transition-colors font-bold text-sm shadow-sm cursor-pointer"
                    >
                        <Plus size={18} />
                        <span className="hidden sm:inline">Add Transaction</span>
                    </button>
                </div>
            </div>

            {/* Time range pill-tabs filter */}
            <div className="flex items-center gap-2 mb-6 bg-slate-100 dark:bg-slate-800/60 p-1.5 rounded-xl w-fit border border-slate-200/60 dark:border-slate-700/60 transition-colors">
                {(['all', 'today', 'week', 'month'] as TimeRange[]).map((range) => (
                    <button
                        key={range}
                        onClick={() => setTimeRange(range)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-serif font-medium capitalize transition-all cursor-pointer ${
                            timeRange === range
                                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {range === 'all' ? 'All Time' : range}
                    </button>
                ))}
            </div>

            {/* Summary metric cards */}
            <SummaryCards transactions={filteredTransactions} />

            {/* Visual charts and transaction list */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryPieChart transactions={filteredTransactions} />
                <RecentTransactions 
                    transactions={filteredTransactions} 
                    onDeleteTransaction={handleDeleteTransaction}
                    onEditTransaction={(tx) => setEditingTransaction(tx)}
                />
            </div>

            {/* Modal for adding transaction */}
            <TransactionModal
                key="add-modal"
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleAddTransaction}
            />

            {/* Modal for editing transaction */}
            <TransactionModal
                key={editingTransaction ? String(editingTransaction.id) : "edit-modal"}
                isOpen={Boolean(editingTransaction)}
                initialData={editingTransaction}
                onClose={() => setEditingTransaction(null)}
                onSubmit={handleUpdateTransaction}
            />
        </DashboardLayout>
    );
}

export default App;
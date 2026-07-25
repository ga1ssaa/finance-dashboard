import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./components/DashboardLayout";
import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import RecentTransactions from "./features/dashboard/RecentTransactions";
import TransactionModal from "./features/dashboard/TransactionModal";
import TransactionsPage from "./pages/TransactionsPage";
import {UseTheme} from "./hooks/UseTheme";
import type { TimeRange } from "./hooks/UseTransactions";
import {UseTransactions} from "./hooks/UseTransactions";
import { Plus, Moon, Sun } from "lucide-react";

function App() {
    // Custom hooks for theme and transaction logic
    const { isDarkMode, toggleTheme } = UseTheme();
    const {
        transactions,
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
        <Routes>
            {/* Main Page (Dashboard) */}
            <Route
                path="/"
                element={
                    <div className="space-y-6">
                    {/* Dashboard Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                            <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                            Financial Dashboard
                            </h2>
                            <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                            Personal wealth management overview
                            </p>
                    </div>

                    {/* Theme Toggle and Add Transaction Button */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleTheme}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer"
                            title="Toggle Dark Mode"
                        >
                            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                        </button>

                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl transition-colors font-bold text-sm shadow-sm cursor-pointer w-fit"
                        >
                            <Plus size={18} />
                            <span>Add Transaction</span>
                        </button>
                    </div>
                </div>

                {/* Time Range Filter */}
                <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/60 p-1.5 rounded-xl w-fit border border-slate-200/60 dark:border-slate-700/60 transition-colors">
                    {(['all', 'today', 'week', 'month'] as TimeRange[]).map((range) => (
                        <button
                            key={range}
                            onClick={() => setTimeRange(range)}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-serif font-medium capitalize transition-all cursor-pointer ${
                            timeRange === range ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                        >
                            {range === 'all' ? 'All Time' : range}
                        </button>
                    ))}
                </div>

                {/* Summary Cards Overview */}
                <SummaryCards transactions={filteredTransactions} />

                {/* Analytics & Recent Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <CategoryPieChart transactions={filteredTransactions} />
                    <RecentTransactions
                        transactions={filteredTransactions}
                        onDeleteTransaction={handleDeleteTransaction}
                        onEditTransaction={(tx) => setEditingTransaction(tx)}
                    />
                </div>
            </div>
            }
        />

        {/* ALL TRANSACTIONS PAGE */}
        <Route
            path="/transactions"
            element={
                <TransactionsPage
                    transactions={transactions}
                    onDeleteTransaction={handleDeleteTransaction}
                    onEditTransaction={(tx) => setEditingTransaction(tx)}
                    onOpenAddModal={() => setIsModalOpen(true)}
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                />
            }
        />
            </Routes>

        {/* Global Modals (Add & Edit Transactions) */}
        <TransactionModal
            key="add-modal"
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSubmit={handleAddTransaction}
        />

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
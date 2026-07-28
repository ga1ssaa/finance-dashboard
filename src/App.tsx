import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./components/DashboardLayout";
import { useState } from "react";

import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import RecentTransactions from "./features/dashboard/RecentTransactions";
import TransactionModal from "./components/modals/TransactionModal";
import SubscriptionModal from "./components/modals/SubscriptionModal";
import BudgetModal from "./components/modals/BudgetModal";

import TransactionsPage from "./pages/TransactionsPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import BudgetGoalsPage from "./pages/BudgetGoalsPage";
import SettingsPage from "./pages/SettingsPage";

import useTheme from "./hooks/useTheme";
import useTransactions from "./hooks/useTransactions";
import { useBudget } from "./hooks/useBudget";
import type { TimeRange } from "./hooks/useTransactions";
import useSubscriptions from "./hooks/useSubscriptions";
import { Plus, Moon, Sun } from "lucide-react";

function App() {
    // Custom hooks for theme and transaction logic
    const { isDarkMode, toggleTheme } = useTheme();

    const {
        transactions,
        filteredTransactions,
        timeRange,
        setTimeRange,
        isModalOpen: isTxModalOpen,       
        setIsModalOpen: setIsTxModalOpen, 
        editingTransaction,
        setEditingTransaction,
        handleAddTransaction,
        handleUpdateTransaction,
        handleDeleteTransaction,
    } = useTransactions();

    const {
        subscriptions,
        isModalOpen: isSubModalOpen,      
        setIsModalOpen: setIsSubModalOpen, 
        handleAddSubscription,
    } = useSubscriptions();

    const {monthlyIncome, setMonthlyIncome, spentData} = useBudget();
    const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
    
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
                            onClick={() => setIsTxModalOpen(true)}
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
                    onOpenAddModal={() => setIsTxModalOpen(true)}
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                />
            }
        />
            
        {/* SUBSCRIPTIONS PAGE */}
        <Route 
            path="/subscriptions"
            element={
                <SubscriptionsPage 
                    subscriptions={subscriptions}
                    onOpenAddModal={() => setIsSubModalOpen(true)}
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                />
            }
        />
        
        {/* BUDGET & GOALS PAGE */}
        <Route 
            path="/budget"
            element={
                <BudgetGoalsPage
                    monthlyIncome={monthlyIncome}
                    spentData={spentData}
                    onOpenSetBudgetModal={() => setIsBudgetModalOpen(true)}
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                />
            }
        />

        {/* SETTINGS PAGE */}
        <Route
            path="/settings"
            element={
                <SettingsPage
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                />
            }
        />
            </Routes>

        {/* Global Modals (Add and Edit Transactions) */}
        <TransactionModal
            key="add-modal"
            isOpen={isTxModalOpen}
            onClose={() => setIsTxModalOpen(false)}
            onSubmit={handleAddTransaction}
        />

        <TransactionModal
            key={editingTransaction ? String(editingTransaction.id) : "edit-modal"}
            isOpen={Boolean(editingTransaction)}
            initialData={editingTransaction}
            onClose={() => setEditingTransaction(null)}
            onSubmit={handleUpdateTransaction}
        />

        {/* Modal for Subscriptions */}
        <SubscriptionModal 
            key={isSubModalOpen ? "sub-modal-open" : "sub-modal-closed"} 
            isOpen={isSubModalOpen}
            onClose={() => setIsSubModalOpen(false)}
            onSubmit={handleAddSubscription}
        />

        {/* Modal for Budget Settings */}
        <BudgetModal
            key={isBudgetModalOpen ? "budget-modal-open" : "budget-modal-closed"}
            isOpen={isBudgetModalOpen}
            onClose={() => setIsBudgetModalOpen(false)}
            currentIncome={monthlyIncome}
            onSubmit={(newIncome) => {
              setMonthlyIncome(newIncome);
            }}
        />
        </DashboardLayout>
    );
}
export default App;
import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./components/DashboardLayout";


import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import RecentTransactions from "./features/dashboard/RecentTransactions";
import TransactionModal from "./components/modals/TransactionModal";
import SubscriptionModal from "./components/modals/SubscriptionModal";
import ResourceStatus from "./components/ResourceStatus";

import TransactionsPage from "./pages/TransactionsPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import BudgetGoalsPage from "./pages/BudgetGoalsPage";
import SettingsPage from "./pages/SettingsPage";

import { useSettings } from "./hooks/useSettings";
import useTheme from "./hooks/useTheme";
import useTransactions from "./hooks/useTransactions";
import { useBudget } from "./hooks/useBudget";
import { useInsights } from "./hooks/useInsights";
import SmartInsights from "./features/dashboard/SmartInsights";
import type { TimeRange } from "./hooks/useTransactions";
import useSubscriptions from "./hooks/useSubscriptions";
import { Plus, Moon, Sun } from "lucide-react";

function App() {
    // Custom hooks for theme and transaction logic
    const { isDarkMode, toggleTheme } = useTheme();
    const {preferenceLoading, preferenceError, refresh} = useSettings();

    const {
        dashboard,
        recent,
        recentFilterType,
        setRecentFilterType,
        recentSortBy,
        setRecentSortBy,
        mutationError: txError,
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
        mutationError: subError,
        isModalOpen: isSubModalOpen,       
        setIsModalOpen: setIsSubModalOpen, 
        editingSubscription,
        setEditingSubscription,
        handleAddSubscription,
        handleUpdateSubscription,
        handleDeleteSubscription,
    } = useSubscriptions();

    const {monthlyIncome, spentData} = useBudget();
    const {insights} = useInsights({
        monthlyIncome,
        spentData,
        transactions: dashboard.data?.transaction_count ? [{amount: 0}] : [],
    });

    return (
        <DashboardLayout>
        <ResourceStatus error={txError || subError || preferenceError} retry={refresh} />
        {preferenceLoading && <p role="status" className="text-sm text-slate-500">Loading currency preference… Monetary forms are available once ready.</p>}
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
                            disabled={preferenceLoading || Boolean(preferenceError)} onClick={() => setIsTxModalOpen(true)}
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

                {/* AI - advisor */}
                <ResourceStatus loading={dashboard.loading} error={dashboard.error} retry={dashboard.retry} />
                {dashboard.data && <SmartInsights insights = {insights} />}

                {/* Summary Cards Overview */}
                {dashboard.data && <SummaryCards summary={dashboard.data} />}

                {/* Analytics & Recent Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                    <CategoryPieChart categories={dashboard.data?.expense_by_category || []} />
                    <RecentTransactions
                        filterType={recentFilterType}
                        setFilterType={setRecentFilterType}
                        sortBy={recentSortBy}
                        setSortBy={setRecentSortBy}
                        loading={recent.loading}
                        error={recent.error}
                        retry={recent.retry}
                        transactions={filteredTransactions}
                        onDeleteTransaction={handleDeleteTransaction}
                        onEditTransaction={(tx) => { if (!preferenceLoading && !preferenceError) setEditingTransaction(tx); }}
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
                    onDeleteTransaction={handleDeleteTransaction}
                    onEditTransaction={(tx) => { if (!preferenceLoading && !preferenceError) setEditingTransaction(tx); }}
                    onOpenAddModal={() => { if (!preferenceLoading && !preferenceError) setIsTxModalOpen(true); }}
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
                    onDeleteSubscription={handleDeleteSubscription}
                    onEditSubscription={(sub) => { if (!preferenceLoading && !preferenceError) setEditingSubscription(sub); }}
                    onOpenAddModal={() => { if (!preferenceLoading && !preferenceError) setIsSubModalOpen(true); }}
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
        {isTxModalOpen && <TransactionModal
            key={isTxModalOpen ? "add-modal-open" : "add-modal"}
            isOpen={isTxModalOpen}
            onClose={() => setIsTxModalOpen(false)}
            onSubmit={handleAddTransaction}
        />}

        <TransactionModal
            key={editingTransaction ? String(editingTransaction.id) : "edit-modal"}
            isOpen={Boolean(editingTransaction)}
            initialData={editingTransaction}
            onClose={() => setEditingTransaction(null)}
            onSubmit={handleUpdateTransaction}
        />

        {/* Global Modals for Subscriptions (Add and Edit) */}
        {isSubModalOpen && <SubscriptionModal
            key={isSubModalOpen ? "add-sub-open" : "add-sub-modal"}
            isOpen={isSubModalOpen}
            onClose={() => setIsSubModalOpen(false)}
            onSubmit={handleAddSubscription}
        />}

        <SubscriptionModal
            key={editingSubscription ? String(editingSubscription.id) : "edit-sub-modal"}
            isOpen={Boolean(editingSubscription)}
            initialData={editingSubscription}
            onClose={() => setEditingSubscription(null)}
            onSubmit={(subData) => {
                if (editingSubscription) {
                    return handleUpdateSubscription(editingSubscription.id, subData);
                }
                return Promise.resolve();
            }}
        />

        </DashboardLayout>
    );
}
export default App;
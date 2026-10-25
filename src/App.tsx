import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./components/DashboardLayout";


import TransactionModal from "./components/modals/TransactionModal";
import SubscriptionModal from "./components/modals/SubscriptionModal";
import ResourceStatus from "./components/ResourceStatus";

import OverviewPage from "./pages/OverviewPage";
import TransactionsPage from "./pages/TransactionsPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import BudgetGoalsPage from "./pages/BudgetGoalsPage";
import SettingsPage from "./pages/SettingsPage";

import { useSettings } from "./hooks/useSettings";
import useTheme from "./hooks/useTheme";
import useTransactions from "./hooks/useTransactions";
import useSubscriptions from "./hooks/useSubscriptions";

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

    return (
        <DashboardLayout isDarkMode={isDarkMode} toggleTheme={toggleTheme}>
        <ResourceStatus error={txError || subError || preferenceError} retry={refresh} />
        {preferenceLoading && <p role="status" className="text-sm text-secondary">Loading currency preference… Monetary forms are available once ready.</p>}
        <Routes>
            {/* Main Page (Dashboard) */}
            <Route
                path="/"
                element={
                    <OverviewPage
                        dashboard={dashboard}
                        recent={recent}
                        transactions={filteredTransactions}
                        timeRange={timeRange}
                        setTimeRange={setTimeRange}
                        recentFilterType={recentFilterType}
                        setRecentFilterType={setRecentFilterType}
                        recentSortBy={recentSortBy}
                        setRecentSortBy={setRecentSortBy}
                        canCreate={!preferenceLoading && !preferenceError}
                        onAddTransaction={() => { if (!preferenceLoading && !preferenceError) setIsTxModalOpen(true); }}
                        onAddSubscription={() => { if (!preferenceLoading && !preferenceError) setIsSubModalOpen(true); }}
                        onEditTransaction={(tx) => { if (!preferenceLoading && !preferenceError) setEditingTransaction(tx); }}
                        onDeleteTransaction={handleDeleteTransaction}
                    />
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
                />
            }
        />
        
        {/* BUDGET & GOALS PAGE */}
        <Route 
            path="/budget"
            element={
                <BudgetGoalsPage />
            }
        />

        {/* SETTINGS PAGE */}
        <Route
            path="/settings"
            element={
                <SettingsPage />
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
import { useState } from "react";
import DashboardLayout from "./components/DashboardLayout";
import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import RecentTransactions from "./features/dashboard/RecentTransactions";
import AddTransactionModal from "./features/dashboard/AddTransactionModal";
import { mockTransactions } from "./utils/mockData"
import type { Transaction } from "./types/finance";
import { Plus } from "lucide-react";

function App(){

    // Wrapping mockTransaction to useState
    const [transactions, setTransactions] = useState<Transaction[]>(mockTransactions);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Function which adds new Transaction at the start of the Array
    const handleAddTransaction = (newTx: Transaction) => {
        setTransactions((prev) => [newTx, ...prev]);
    }

    const handleDeleteTransaction = (id: string | number) => {
        setTransactions((prev) => prev.filter((transaction) => transaction.id !== id));
    }

    return(
        <DashboardLayout>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="font-serif font-bold text-2xl text-slate-800">
                        Financial Overview
                    </h2>
                    <p className="text-slate-500 text-sm">
                        Track your income and expenses
                    </p>
                </div>
            
            {/* Switching isModalOpen to true  */}
                <button
                    onClick = {() => setIsModalOpen(true)}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 hover:scale-105 text-white px-4 py-2.5 rounded-xl transition-colors font-bold text-sm shadow-sm"
                >
                    <Plus size={18} />
                    Add Transaction
                </button>
            </div>

            <SummaryCards transactions={transactions} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryPieChart transactions={transactions}/>
                <RecentTransactions 
                    transactions={transactions} 
                    onDeleteTransaction={handleDeleteTransaction}
                />
            </div>

            {/* Adding modal and giving props to it */}
            <AddTransactionModal 
                isOpen = {isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onAddTransaction={handleAddTransaction}
            />

        </DashboardLayout>
    );
}
export default App
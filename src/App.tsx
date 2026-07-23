import { useState, useEffect } from "react";
import DashboardLayout from "./components/DashboardLayout";
import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import RecentTransactions from "./features/dashboard/RecentTransactions";
import AddTransactionModal from "./features/dashboard/AddTransactionModal";
import { mockTransactions } from "./utils/mockData"
import type { Transaction } from "./types/finance";
import { Plus, Moon, Sun } from "lucide-react";

const STORAGE_KEY = "finance_app_transactions";
const THEME_KEY = "finance_app_theme";

function App(){

    // Wrapping mockTransaction to useState
    const [transactions, setTransactions] = useState<Transaction[]>(() => {

        const savedTransactions = localStorage.getItem(STORAGE_KEY);
        if(savedTransactions){
            try{
                return JSON.parse(savedTransactions);
            }
            catch(error){
                console.error("Failed to parse transactions from localStorage:", error);
            }
        }
        return mockTransactions;
    });

    const [isModalOpen, setIsModalOpen] = useState(false);

    const [isDarkMode, setIsDarkMode] = useState(() => {
        return localStorage.getItem(THEME_KEY) === "dark";
    })

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    }, [transactions]);

    useEffect(() => {
        if(isDarkMode){
            document.documentElement.classList.add('dark');
            localStorage.setItem(THEME_KEY, 'dark');
        }
        else{
            document.documentElement.classList.remove('dark');
            localStorage.setItem(THEME_KEY, 'light');
        }
    }, [isDarkMode])

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
                    <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                        Financial Overview
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                        Track your income and expenses
                    </p>
                </div>

                <div className="flex items-center gap-3">
            {/* Switching to Dark/Light Mode  */}
                    <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                        title="Toggle Dark Mode"
                    >
                        {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                
            {/* Switching isModalOpen to true  */}
                    <button
                        onClick = {() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 hover:scale-105 text-white px-4 py-2.5 rounded-xl transition-colors font-bold text-sm shadow-sm"
                    >
                        <Plus size={18} />
                        <span className="hidden sm:inline">Add Transaction</span>
                    </button>
                </div>
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
import { ArrowDownRight, ArrowUpRight, DollarSign } from "lucide-react"
import type { Transaction } from "../../types/finance"

interface SummaryCardsProps {
    transactions: Transaction[];
};

function SummaryCards({transactions}: SummaryCardsProps ){

    {/* Income Formula */}
    const totalIncome = transactions
        .filter((t) => t.type === "income" )
        .reduce((sum, transaction) => sum+transaction.amount, 0);
    
    {/* Expense Formula */}
    const totalExpense = transactions
        .filter((t) => t.type === "expense")
        .reduce((sum, transaction) => sum+transaction.amount, 0);
    
    {/* Accounting Balance */}
    const balance = totalIncome - totalExpense;

    return(
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* 1st Card: Total Balance  */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors duration-200">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="font-serif text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 transition-colors">
                            Total Balance
                        </p>
                        <h3 className="text-2xl font-bold text-slate-800 dark:text-white transition-colors">
                            ${balance}
                        </h3>
                    </div>
                    <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/40 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 transition-colors">
                        <DollarSign size={24}/>
                    </div>
                </div>
            </div>

            {/* 2nd Card: Income */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors duration-200">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="font-serif text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 transition-colors">
                            Total Income 
                        </p>
                        <h3 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 transition-colors">
                            ${totalIncome}
                        </h3>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/40 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 transition-colors">
                        <ArrowUpRight size={24}/>
                    </div>
                </div>
            </div>

            {/* 3rd Card: Expense */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors duration-200">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="font-serif text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 transition-colors">
                            Total Expense
                        </p>
                        <h3 className="text-2xl font-bold text-rose-600 dark:text-rose-400 transition-colors">
                            ${totalExpense}
                        </h3>
                    </div>
                    <div className="w-12 h-12 bg-rose-50 dark:bg-rose-900/40 rounded-full flex items-center justify-center text-rose-600 dark:text-rose-400 transition-colors">
                        <ArrowDownRight size={24}/>
                    </div>
                </div>
            </div>
        </div>
    );

}
export default SummaryCards
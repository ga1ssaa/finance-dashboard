import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import type { Transaction } from "../../types/finance"

interface RecentTransactionsProps {
    transactions: Transaction[];
};

function RecentTransactions({transactions}: RecentTransactionsProps){
    //Sorting the of array(from new to old) 
    const recentTransactions = [...transactions]
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0,5);
    
    return(
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm h-80 flex flex-col">
            <h3 className="font-serif text-lg font-semibold text-slate-800 mb-4">
                Recent Transactions
            </h3>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {recentTransactions.map((transaction) => (
                    <div
                        key={transaction.id}
                        className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                        <div className="flex items-center gap-4">

                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                transaction.type === 'income' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                            }`}>
                                {transaction.type === 'income' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                            </div>

                            <div>
                                    <p className="font-serif font-medium text-slate-800">{transaction.title}</p>
                                    <p className="text-sm text-slate-500">{transaction.category} • {transaction.date}</p>
                            </div>
                            </div>

                            <div className={`font-bold ${
                                transaction.type === 'income' ? 'text-emerald-600' : 'text-slate-800'
                            }`}>
                                {transaction.type === 'income' ? '+' : '-'}${transaction.amount}
                            </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
export default RecentTransactions
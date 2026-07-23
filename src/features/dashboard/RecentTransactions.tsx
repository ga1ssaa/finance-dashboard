import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Trash2, Filter, ArrowUpDown } from "lucide-react"
import type { Transaction } from "../../types/finance"

interface RecentTransactionsProps {
    transactions: Transaction[];
    onDeleteTransaction: (id: string | number) => void;
};

type FilterType = 'all' | 'income' | 'expense';
type SortType = 'data-asc' | 'data-desc' | 'amount-asc' | 'amount-desc';

function RecentTransactions({transactions, onDeleteTransaction}: RecentTransactionsProps){

    // 1. State for Filter
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [sortBy, setSortBy] = useState<SortType>('data-desc');

    // 2. Filtering transaction through type
    const filteredTransactions = transactions.filter((tx) => {
        if(filterType === 'all') return true;
        return tx.type === filterType;
    })

    // 3. Sorting from old to new
    const displayTransactions = [...filteredTransactions].sort((a,b) => {

        if(sortBy === 'data-desc'){
            return new Date(b.date).getTime() - new Date(a.date).getTime()
        }
        if(sortBy === 'data-asc'){
            return new Date(a.date).getTime() - new Date(b.date).getTime();
        }
        if(sortBy === 'amount-desc'){
            return b.amount - a.amount;
        }
        if(sortBy === 'amount-asc'){
            return a.amount - b.amount;
        }
        return 0;
    }); 

    return(
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm h-80 flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-lg font-semibold text-slate-800">
                    Recent Transactions
                </h3>
                
                <div className="flex items-center gap-2">

                    {/* Block with select options */}
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
                            <Filter size={14} className="text-slate-400"/>
                            <select 
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value as FilterType)}
                                className="bg-transparent focus:outline-none text-slate-700 font-medium cursor-pointer"
                            >
                                <option value="all">All</option>
                                <option value="income">Income</option>
                                <option value="expense">Expense</option>
                            </select>
                        </div>

                    {/* Sorting select */}

                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
                        <ArrowUpDown size={14}/>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortType)}
                            className="bg-transparent focus:outline-none text-slate-700 font-medium cursor-pointer"
                        >
                            <option value="data-desc">Newest First</option>
                            <option value="data-asc">Oldest First</option>
                            <option value="amount-desc">Highest Amount</option>
                            <option value="amount-asc">Lowest Amount</option>
                        </select>
                    </div>
                </div>
            </div>



            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                    {displayTransactions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                            No Transaction Found
                        </div>
                    ) : (
                        displayTransactions.map((transaction) => (
                        <div
                            key={transaction.id}
                            className="group flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg transition-colors"
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
                                <div className="flex items-center gap-3">
                                    <div className={`font-bold ${
                                    transaction.type === 'income' ? 'text-emerald-600' : 'text-slate-800'
                                }`}>
                                    {transaction.type === 'income' ? '+' : '-'}${transaction.amount}
                                    </div>
                                    <button
                                        onClick={() => onDeleteTransaction(transaction.id)}
                                        className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                        title="Delete transaction"
                                    >
                                        <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
export default RecentTransactions
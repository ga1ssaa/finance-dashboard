import { Filter, ArrowUpDown } from "lucide-react";

export type FilterType = 'all' | 'income' | 'expense';
export type SortType = 'date-asc' | 'date-desc' | 'amount-asc' | 'amount-desc';

interface TransactionFiltersProps {
  filterType: FilterType;
  setFilterType: (type: FilterType) => void;
  sortBy: SortType;
  setSortBy: (sort: SortType) => void;
}

function TransactionFilters({ filterType, setFilterType, sortBy, setSortBy}: TransactionFiltersProps) {
    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs transition-colors">
                <Filter size={14} className="text-slate-400 dark:text-slate-500" />
                <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as FilterType)}
                    className="bg-transparent focus:outline-none text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
                >
                    <option value="all" className="dark:bg-slate-800">All</option>
                    <option value="income" className="dark:bg-slate-800">Income</option>
                    <option value="expense" className="dark:bg-slate-800">Expense</option>
                </select>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs transition-colors">
                <ArrowUpDown size={14} className="text-slate-400 dark:text-slate-500" />
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortType)}
                    className="bg-transparent focus:outline-none text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
                >
                    <option value="date-desc" className="dark:bg-slate-800">Newest First</option>
                    <option value="date-asc" className="dark:bg-slate-800">Oldest First</option>
                    <option value="amount-desc" className="dark:bg-slate-800">Highest Amount</option>
                    <option value="amount-asc" className="dark:bg-slate-800">Lowest Amount</option>
                </select>
            </div>
        </div>
    );
}

export default TransactionFilters
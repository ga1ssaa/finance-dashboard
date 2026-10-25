import SelectControl from "../../components/SelectControl";
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
        <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
                <SelectControl
                    leadingIcon={<Filter size={16} />}
                    aria-label="Transaction type"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as FilterType)}
                    className="border-subtle bg-canvas text-xs text-secondary font-medium cursor-pointer focus:outline-none"
                >
                    <option value="all" className="dark:bg-surface">All</option>
                    <option value="income" className="dark:bg-surface">Income</option>
                    <option value="expense" className="dark:bg-surface">Expense</option>
                </SelectControl>
                <SelectControl
                    leadingIcon={<ArrowUpDown size={16} />}
                    aria-label="Sort transactions"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortType)}
                    className="border-subtle bg-canvas text-xs text-secondary font-medium cursor-pointer focus:outline-none"
                >
                    <option value="date-desc" className="dark:bg-surface">Newest First</option>
                    <option value="date-asc" className="dark:bg-surface">Oldest First</option>
                    <option value="amount-desc" className="dark:bg-surface">Highest Amount</option>
                    <option value="amount-asc" className="dark:bg-surface">Lowest Amount</option>
                </SelectControl>
        </div>
    );
}

export default TransactionFilters

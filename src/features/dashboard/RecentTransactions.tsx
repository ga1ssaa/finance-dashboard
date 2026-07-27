import { useState, useMemo } from "react";
import type { Transaction } from "../../types/finance";
import TransactionItem from "../transactions/TransactionItem";
import TransactionFilters from "../transactions/TransactionFilters";
import type { FilterType, SortType } from "../transactions/TransactionFilters";

interface RecentTransactionsProps {
  transactions: Transaction[];
  onDeleteTransaction: (id: string | number) => void;
  onEditTransaction: (transaction: Transaction) => void;
}

function RecentTransactions({ transactions, onDeleteTransaction, onEditTransaction }: RecentTransactionsProps) {
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('date-desc');

  const displayTransactions = useMemo(() => {
    return transactions
      .filter((tx) => filterType === 'all' || tx.type === filterType)
      .sort((a, b) => {
        if (sortBy === 'date-desc') return new Date(b.date).getTime() - new Date(a.date).getTime();
        if (sortBy === 'date-asc') return new Date(a.date).getTime() - new Date(b.date).getTime();
        if (sortBy === 'amount-desc') return b.amount - a.amount;
        if (sortBy === 'amount-asc') return a.amount - b.amount;
        return 0;
      });
  }, [transactions, filterType, sortBy]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm h-80 flex flex-col transition-colors duration-200">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-white transition-colors">
          Recent Transactions
        </h3>

        <TransactionFilters
          filterType={filterType}
          setFilterType={setFilterType}
          sortBy={sortBy}
          setSortBy={setSortBy}
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-2">
        {displayTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 text-sm">
            No Transaction Found
          </div>
        ) : (
          displayTransactions.map((transaction) => (
            <TransactionItem
              key={transaction.id}
              transaction={transaction}
              onDelete={onDeleteTransaction}
              onEdit={onEditTransaction}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default RecentTransactions;
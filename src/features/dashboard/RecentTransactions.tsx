import ResourceStatus from "../../components/ResourceStatus";
import type { Transaction } from "../../types/finance";
import TransactionItem from "../transactions/TransactionItem";
import TransactionFilters from "../transactions/TransactionFilters";
import type {FilterType, SortType} from "../transactions/TransactionFilters";

interface RecentTransactionsProps {
    transactions: Transaction[];
    filterType: FilterType;
    setFilterType: (type: FilterType) => void;
    sortBy: SortType;
    setSortBy: (sort: SortType) => void;
    loading: boolean;
    error: string;
    retry: () => void;
    onDeleteTransaction: (id: string | number) => void;
    onEditTransaction: (transaction: Transaction) => void;
}

function RecentTransactions({
    transactions,
    filterType,
    setFilterType,
    sortBy,
    setSortBy,
    loading,
    error,
    retry,
    onDeleteTransaction,
    onEditTransaction,
}: RecentTransactionsProps) {
      return (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 md:p-6 border border-slate-200 dark:border-slate-700 shadow-sm min-h-[420px] md:h-80 flex flex-col transition-colors duration-200">

            {/* Header */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">

              <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-white">
                Recent Transactions
              </h3>

              <TransactionFilters
                filterType={filterType}
                setFilterType={setFilterType}
                sortBy={sortBy}
                setSortBy={setSortBy}
              />

            </div>

            {/* Transactions */}
            <div className="flex-1 overflow-y-auto space-y-2 md:pr-2">

              <ResourceStatus loading={loading} error={error} retry={retry} />
              {!loading && !error && transactions.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-slate-400 dark:text-slate-500">
                  No Transactions Found
                </div>
            ) : (
                transactions.map((transaction) => (
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
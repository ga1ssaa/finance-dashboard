import { useState } from "react";
import { Search, Plus } from "lucide-react";
import type { Transaction } from "../types/finance";
import { useResource } from "../hooks/useResource";
import { transactionFromApi } from "../hooks/useTransactions";
import type { Page, TransactionRecord } from "../api/client";
import ResourceStatus from "../components/ResourceStatus";
import TransactionItem from "../features/transactions/TransactionItem";
import TransactionFilters from "../features/transactions/TransactionFilters";
import type { FilterType, SortType } from "../features/transactions/TransactionFilters";

interface TransactionsPageProps {
    onDeleteTransaction: (id: string | number) => void;
    onEditTransaction: (transaction: Transaction) => void;
    onOpenAddModal: () => void;
}

function TransactionsPage({onDeleteTransaction, onEditTransaction, onOpenAddModal}: TransactionsPageProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [sortBy, setSortBy] = useState<SortType>('date-desc');

    const [offset, setOffset] = useState(0);
    const [sortField, direction] = sortBy.split('-');
    const query = new URLSearchParams({limit:'20', offset:String(offset), q:searchTerm, sort_by:sortField === 'date' ? 'transaction_date' : 'amount_usd', sort_direction:direction});
    if (filterType !== 'all') query.set('type', filterType);
    const resource = useResource<Page<TransactionRecord>>(`/transactions?${query}`);
    const processedTransactions = (resource.data?.items || []).map(transactionFromApi);

    return (
            <div className="ui-page">
            {/* Header */}
            <div className="ui-page-header">
                <div>
                <h2 className="ui-page-title">
                    All Transactions
                </h2>
                <p className="ui-page-description">
                    Manage and search your complete history
                </p>
                </div>

                <div className="flex items-center gap-3">
                <button
                    onClick={onOpenAddModal}
                    className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-accent-ink px-4 py-2.5 rounded-control font-semibold text-sm shadow-none cursor-pointer transition-colors w-fit"
                >
                    <Plus size={18} />
                    <span>Add Transaction</span>
                </button>
                </div>
            </div>

            {/* Search Bar + Filters */}
            <div className="ui-panel flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full md:w-80">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                    type="text"
                    aria-label="Search transactions by title or category"
                    placeholder="Search by title or category..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setOffset(0); }}
                    className="w-full pl-10 pr-4 py-2 bg-canvas border border-control rounded-control text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors"
                />
                </div>

                <TransactionFilters
                    filterType={filterType}
                    setFilterType={value => {setFilterType(value);setOffset(0);}}
                    sortBy={sortBy}
                    setSortBy={value => {setSortBy(value);setOffset(0);}}
                />
            </div>

        {/* Full List */}
            <div className="ui-panel">
                {processedTransactions.length > 0 && <div aria-hidden="true" className="ui-transaction-columns"><span>Transaction</span><span>Category</span><span>Date</span><span className="text-right">Amount</span><span className="text-right">Actions</span></div>}
                <div className="divide-y divide-subtle">
                <ResourceStatus loading={resource.loading} error={resource.error} retry={resource.retry} />
                {!resource.loading && !resource.error && processedTransactions.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">No transactions found.</p><p className="mt-1 text-sm text-secondary">Add a record or adjust your search and filters.</p></div><button type="button" onClick={onOpenAddModal} className="ui-primary-action">Add Transaction</button></div>
                ) : (
                processedTransactions.map((tx) => (
                    <TransactionItem
                        key={tx.id}
                        transaction={tx}
                        onDelete={onDeleteTransaction}
                        onEdit={onEditTransaction}
                    />
                    ))
                )}
                </div>
            </div>
            <div className="ui-pagination">
                <button disabled={offset===0 || resource.loading} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</button>
                <span>{resource.data?.total || 0} transactions · Page {Math.floor(offset/20)+1}</span>
                <button disabled={resource.loading || !resource.data || offset+20 >= resource.data.total} onClick={()=>setOffset(offset+20)}>Next</button>
            </div>
        </div>
    );
}
export default TransactionsPage;
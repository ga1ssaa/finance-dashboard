import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import ResourceStatus from '../../components/ResourceStatus';
import type { Transaction } from '../../types/finance';
import { useSettings } from '../../hooks/useSettings';
import { formatCalendarDate } from '../../utils/dates';
import TransactionFilters from '../transactions/TransactionFilters';
import type { FilterType, SortType } from '../transactions/TransactionFilters';

interface Props {
    transactions: Transaction[];
    filterType: FilterType;
    setFilterType: (type: FilterType) => void;
    sortBy: SortType;
    setSortBy: (sort: SortType) => void;
    loading: boolean;
    error: string;
    retry: () => void;
    canEdit: boolean;
    onAdd: () => void;
    onDeleteTransaction: (id: string | number) => void;
    onEditTransaction: (transaction: Transaction) => void;
}

export default function RecentTransactions(props: Props) {
    const { formatAmount } = useSettings();
    const rows = props.transactions.slice(0, 5);
    return (
        <section aria-labelledby="recent-transactions-title" className="overview-section">
            <div className="overview-section-heading">
                <div><h2 id="recent-transactions-title" className="text-lg font-semibold">Recent transactions</h2><p className="mt-1 text-xs text-secondary">Up to five records in the selected period and sort order</p></div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                    <TransactionFilters filterType={props.filterType} setFilterType={props.setFilterType} sortBy={props.sortBy} setSortBy={props.setSortBy} />
                    <Link to="/transactions" className="overview-text-link" aria-label="View all transactions">View all</Link>
                </div>
            </div>
            <ResourceStatus loading={props.loading} error={props.error} retry={props.retry} />
            {!props.loading && !props.error && (rows.length ? (
                <div>
                <div aria-hidden="true" className="ui-transaction-columns"><span>Transaction</span><span>Category</span><span>Date</span><span className="text-right">Amount</span><span className="text-right">Actions</span></div>
                <ul className="divide-y divide-subtle" aria-label="Transaction preview">
                    {rows.map(tx => (
                        <li key={tx.id} className="ui-transaction-row">
                            <div className="min-w-0"><p className="font-medium text-primary [overflow-wrap:anywhere]">{tx.title}</p><p className="mt-1 text-xs text-secondary [overflow-wrap:anywhere] md:hidden">{tx.category} · <time dateTime={tx.date}>{formatCalendarDate(tx.date)}</time></p></div>
                            <p className="hidden min-w-0 text-sm text-secondary [overflow-wrap:anywhere] md:block">{tx.category}</p>
                            <time dateTime={tx.date} className="hidden text-xs text-secondary md:block">{formatCalendarDate(tx.date)}</time>
                            <p className={`max-w-[12rem] text-right font-semibold [overflow-wrap:anywhere] ${tx.type === 'income' ? 'text-accent' : 'text-primary'}`}>{tx.type === 'income' ? '+' : '−'}{formatAmount(tx.amount)}</p>
                            <div className="col-span-2 flex justify-end md:col-span-1">
                                <button type="button" disabled={!props.canEdit} className="ui-icon-button" aria-label={`Edit transaction: ${tx.title}`} title="Edit transaction" onClick={() => props.onEditTransaction(tx)}><Pencil size={16} aria-hidden="true" /></button>
                                <button type="button" className="ui-icon-button hover:text-red-600 dark:hover:text-red-300" aria-label={`Delete transaction: ${tx.title}`} title="Delete transaction" onClick={() => props.onDeleteTransaction(tx.id)}><Trash2 size={16} aria-hidden="true" /></button>
                            </div>
                        </li>
                    ))}
                </ul>
                </div>
            ) : (
                <div className="ui-empty-state"><div><p className="font-medium">No {props.filterType === 'all' ? '' : `${props.filterType} `}transactions in this period.</p><p className="mt-1 text-sm text-secondary">Add a transaction or choose another period or filter.</p></div><button type="button" disabled={!props.canEdit} onClick={props.onAdd} className="ui-primary-action">Add transaction</button></div>
            ))}
        </section>
    );
}

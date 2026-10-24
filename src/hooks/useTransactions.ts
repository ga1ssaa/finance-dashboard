import { useRef, useState } from 'react';
import type { Transaction } from '../types/finance';
import { request } from '../api/client';
import type { Page, TransactionRecord, DashboardRecord } from '../api/client';
import { useResource } from './useResource';
import { useFinance } from '../state/financeStore';
import type { FilterType, SortType } from '../features/transactions/TransactionFilters';
export type TimeRange = 'all' | 'today' | 'week' | 'month';
export const transactionFromApi = (item: TransactionRecord): Transaction => ({ id: item.id, title: item.title, amount: item.amount_usd, type: item.type, category: item.category, date: item.transaction_date });
function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function rangeQuery(range: TimeRange) {
    if (range === 'all')
        return '';
    const end = new Date();
    const start = new Date(end);
    if (range === 'week')
        start.setDate(start.getDate() - 7);
    if (range === 'month')
        start.setDate(1);
    return `date_from=${dateString(start)}&date_to=${dateString(end)}`;
}
export function recentQuery(timeRange: TimeRange, filterType: FilterType, sortBy: SortType): string {
    const [field, direction] = sortBy.split('-');
    const query = new URLSearchParams(rangeQuery(timeRange));
    query.set('limit', '10');
    query.set('sort_by', field === 'amount' ? 'amount_usd' : 'transaction_date');
    query.set('sort_direction', direction);
    if (filterType !== 'all') {
        query.set('type', filterType);
    }
    return query.toString();
}
export default function useTransactions() {
    const { refresh } = useFinance();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [timeRange, setTimeRange] = useState<TimeRange>('all');
    const [recentFilterType, setRecentFilterType] = useState<FilterType>('all');
    const [recentSortBy, setRecentSortBy] = useState<SortType>('date-desc');
    const dashboard = useResource<DashboardRecord>(`/dashboard?${rangeQuery(timeRange)}`);
    const recent = useResource<Page<TransactionRecord>>(`/transactions?${recentQuery(timeRange, recentFilterType, recentSortBy)}`);
    const [mutationError, setMutationError] = useState('');
    const pending = useRef(new Set<string>());
    const save = async (transaction: Transaction, edit: boolean) => {
        const key = edit ? transaction.id : 'create';
        if (pending.current.has(key))
            throw new Error('A save is already in progress.');
        pending.current.add(key);
        const body: Record<string, string> = { title: transaction.title, type: transaction.type, category: transaction.category, transaction_date: transaction.date };
        if (!edit || transaction.amount !== editingTransaction?.amount)
            body.amount_usd = transaction.amount;
        try {
            await request(`/transactions${edit ? `/${transaction.id}` : ''}`, { method: edit ? 'PATCH' : 'POST', body: JSON.stringify(body) });
            refresh();
        }
        finally {
            pending.current.delete(key);
        }
    };
    const handleDeleteTransaction = async (id: string | number) => {
        const key = String(id);
        if (pending.current.has(key))
            return;
        pending.current.add(key);
        setMutationError('');
        try {
            await request(`/transactions/${id}`, { method: 'DELETE' });
            refresh();
        }
        catch (error) {
            setMutationError(error instanceof Error ? error.message : 'Delete failed. Please retry.');
        }
        finally {
            pending.current.delete(key);
        }
    };
    return { transactions: (recent.data?.items || []).map(transactionFromApi), filteredTransactions: (recent.data?.items || []).map(transactionFromApi), dashboard, recent, recentFilterType, setRecentFilterType, recentSortBy, setRecentSortBy, timeRange, setTimeRange, isModalOpen, setIsModalOpen, editingTransaction, setEditingTransaction, handleAddTransaction: (value: Transaction) => save(value, false), handleUpdateTransaction: (value: Transaction) => save(value, true), handleDeleteTransaction, mutationError };
}

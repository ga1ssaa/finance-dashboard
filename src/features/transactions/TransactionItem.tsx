import { Trash2, Pencil } from "lucide-react";
import type { Transaction } from "../../types/finance";
import { useSettings } from "../../hooks/useSettings";
import { formatCalendarDate } from "../../utils/dates";

interface TransactionItemProps {
    transaction: Transaction;
    onDelete: (id: string | number) => void;
    onEdit: (transaction: Transaction) => void;
}

export default function TransactionItem({ transaction, onDelete, onEdit }: TransactionItemProps) {
    const { formatAmount } = useSettings();
    const isIncome = transaction.type === 'income';
    return (
        <div className="ui-transaction-row">
            <div className="min-w-0">
                <p className="font-medium text-primary [overflow-wrap:anywhere]">{transaction.title}</p>
                <p className="mt-1 text-xs text-secondary [overflow-wrap:anywhere] md:hidden">{transaction.category} · <time dateTime={transaction.date}>{formatCalendarDate(transaction.date)}</time></p>
            </div>
            <p className="hidden min-w-0 text-sm text-secondary [overflow-wrap:anywhere] md:block">{transaction.category}</p>
            <time dateTime={transaction.date} className="hidden text-xs text-secondary md:block">{formatCalendarDate(transaction.date)}</time>
            <p className={`min-w-0 text-right font-semibold [overflow-wrap:anywhere] ${isIncome ? 'text-accent' : 'text-primary'}`}>{isIncome ? '+' : '−'}{formatAmount(transaction.amount)}</p>
            <div className="col-span-2 flex justify-end md:col-span-1">
                <button type="button" onClick={() => onEdit(transaction)} className="ui-icon-button" aria-label={`Edit transaction: ${transaction.title}`} title="Edit transaction"><Pencil size={16} aria-hidden="true" /></button>
                <button type="button" onClick={() => onDelete(transaction.id)} className="ui-icon-button hover:text-red-600 dark:hover:text-red-300" aria-label={`Delete transaction: ${transaction.title}`} title="Delete transaction"><Trash2 size={16} aria-hidden="true" /></button>
            </div>
        </div>
    );
}

import { ArrowDownRight, ArrowUpRight, Trash2, Pencil } from "lucide-react";
import type { Transaction } from "../../types/finance";

interface TransactionItemProps {
  transaction: Transaction;
  onDelete: (id: string | number) => void;
  onEdit: (transaction: Transaction) => void;
}

function TransactionItem({ transaction, onDelete, onEdit }: TransactionItemProps) {
  const isIncome = transaction.type === 'income';

  return (
    <div className="group flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors">
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          isIncome
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
        }`}>
          {isIncome ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
        </div>

        <div>
          <p className="font-serif font-medium text-slate-800 dark:text-white">{transaction.title}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{transaction.category} • {transaction.date}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className={`font-bold ${
          isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'
        }`}>
          {isIncome ? '+' : '-'}${transaction.amount}
        </div>

        <button
          onClick={() => onEdit(transaction)}
          className="text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
          title="Edit transaction"
        >
          <Pencil size={18} />
        </button>

        <button
          onClick={() => onDelete(transaction.id)}
          className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
          title="Delete transaction"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}

export default TransactionItem
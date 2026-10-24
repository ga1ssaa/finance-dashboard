export type TransactionType = 'income' | 'expense';

export type CategoryType = string;

export interface Transaction {
    id: string;
    title: string;
    amount: string;
    type: TransactionType;
    category: CategoryType;
    date: string;
}

export interface Subscription {
    id: string;
    serviceName: string;
    amount: string;
    nextPaymentDate: string;
    icon: string;
    status: 'active' | 'paused';
}

export interface BudgetCategory {
    id: string;
    label: string;
    spent: number;
    limit: number;
    percentage: number;
}

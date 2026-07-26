export type TransactionType = 'income' | 'expense';

export type CategoryType = | 'Food' | 'Transport' | 'Rent' | 'Salary' | 'Freelance' | 'Other';

export interface Transaction {
    id: number;
    title: string;
    amount: number;
    type: TransactionType;
    category: CategoryType;
    date: string;
}

export interface Subscription {
    id: number | string;
    serviceName: string;
    amount: number;
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

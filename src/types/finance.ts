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

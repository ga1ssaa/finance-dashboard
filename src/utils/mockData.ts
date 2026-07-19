import type { Transaction } from "../types/finance";

export const mockTransactions: Transaction[] = [
    {
        id: 1,
        title: 'Salary',
        amount: 2500,
        type: 'income',
        category: 'Salary',
        date: '2026-07-01',
    },
    {
        id: 2,
        title: 'Store',
        amount: 1200,
        type: 'expense',
        category: 'Food',
        date: '2026-07-15',
    },
    {
        id: 3,
        title: 'Rent',
        amount: 800,
        type: 'expense',
        category: 'Rent',
        date: '2026-07-02',
    },
];

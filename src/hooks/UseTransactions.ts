import { useState, useEffect, useMemo } from "react";
import type { Transaction } from "../types/finance";
import { mockTransactions } from "../utils/mockData";

const STORAGE_KEY = "finance_app_transactions";

export type TimeRange = 'all' | 'today' | 'week' | 'month';

export function UseTransactions() {
    // 1. Storage for ALL transactions
    const [transactions, setTransactions] = useState<Transaction[]>(() => {
        const savedTransactions = localStorage.getItem(STORAGE_KEY);
        if (savedTransactions) {
            try {
                return JSON.parse(savedTransactions);
            } catch (error) {
                console.error("Failed to parse transactions from localStorage:", error);
            }
        }
        return mockTransactions;
    });

    // 2. State for modals and editing
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

    // 3. Time range filter state
    const [timeRange, setTimeRange] = useState<TimeRange>('all');

    // Save transactions to local storage on change
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    }, [transactions]);

    // CRUD Handlers
    const handleAddTransaction = (newTx: Transaction) => {
        setTransactions((prev) => [newTx, ...prev]);
    };

    const handleUpdateTransaction = (updatedTx: Transaction) => {
        setTransactions((prev) =>
            prev.map((tx) => (tx.id === updatedTx.id ? updatedTx : tx))
        );
    };

    const handleDeleteTransaction = (id: string | number) => {
        setTransactions((prev) => prev.filter((transaction) => transaction.id !== id));
    };

    // Filter transactions based on selected time range
    const filteredTransactions = useMemo(() => {
        if (timeRange === 'all') return transactions;

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        return transactions.filter((tx) => {
            const txDate = new Date(`${tx.date}T00:00:00`);

            if (timeRange === 'today') {
                return tx.date === todayStr;
            }

            if (timeRange === 'week') {
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(now.getDate() - 7);
                oneWeekAgo.setHours(0, 0, 0, 0);
                return txDate >= oneWeekAgo && txDate <= now;
            }

            if (timeRange === 'month') {
                return (
                    txDate.getMonth() === now.getMonth() &&
                    txDate.getFullYear() === now.getFullYear()
                );
            }

            return true;
        });
    }, [transactions, timeRange]);

    return {
        transactions,
        filteredTransactions,
        timeRange,
        setTimeRange,
        isModalOpen,
        setIsModalOpen,
        editingTransaction,
        setEditingTransaction,
        handleAddTransaction,
        handleUpdateTransaction,
        handleDeleteTransaction,
    };
}
export default UseTransactions;
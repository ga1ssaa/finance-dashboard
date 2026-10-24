import { useRef, useState } from 'react';
import type { Subscription } from '../types/finance';
import { request } from '../api/client';
import type { SubscriptionRecord } from '../api/client';
import { useFinance } from '../state/financeStore';
export const subscriptionFromApi = (item: SubscriptionRecord): Subscription => ({ id: item.id, serviceName: item.service_name, amount: item.amount_usd, nextPaymentDate: item.next_payment_date, icon: item.icon, status: item.status });
export default function useSubscriptions() {
    const { refresh } = useFinance();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
    const [mutationError, setMutationError] = useState('');
    const pending = useRef(new Set<string>());
    const save = async (value: Omit<Subscription, 'id' | 'icon'>, id?: string | number) => {
        const key = String(id || 'create');
        if (pending.current.has(key))
            throw new Error('A save is already in progress.');
        pending.current.add(key);
        const body: Record<string, string> = { service_name: value.serviceName, next_payment_date: value.nextPaymentDate, status: value.status };
        if (!id || value.amount !== editingSubscription?.amount)
            body.amount_usd = value.amount;
        try {
            await request(`/subscriptions${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
            refresh();
        }
        finally {
            pending.current.delete(key);
        }
    };
    const handleDeleteSubscription = async (id: string | number) => {
        const key = String(id);
        if (pending.current.has(key))
            return;
        pending.current.add(key);
        setMutationError('');
        try {
            await request(`/subscriptions/${id}`, { method: 'DELETE' });
            refresh();
        }
        catch (error) {
            setMutationError(error instanceof Error ? error.message : 'Delete failed. Please retry.');
        }
        finally {
            pending.current.delete(key);
        }
    };
    return { isModalOpen, setIsModalOpen, editingSubscription, setEditingSubscription, handleAddSubscription: (value: Omit<Subscription, 'id' | 'icon'>) => save(value), handleUpdateSubscription: (id: string | number, value: Omit<Subscription, 'id' | 'icon'>) => save(value, id), handleDeleteSubscription, mutationError };
}

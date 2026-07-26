import { useState } from "react";
import type { Subscription } from "../types/finance";

// Initial mock data to start with
const INITIAL_SUBSCRIPTIONS: Subscription[] = [
    { id: 1, serviceName: "Spotify Premium", amount: 9.99, nextPaymentDate: "2026-08-15", icon: "music", status: "active" },
    { id: 2, serviceName: "Netflix", amount: 15.49, nextPaymentDate: "2026-08-20", icon: "monitor", status: "active" },
    { id: 3, serviceName: "Gym Membership", amount: 17.49, nextPaymentDate: "2026-08-01", icon: "dumbbell", status: "active" },
    { id: 4, serviceName: "Claude AI", amount: 52.99, nextPaymentDate: "2026-08-10", icon: "credit-card", status: "paused" },
];

function UseSubscriptions() {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>(INITIAL_SUBSCRIPTIONS);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

    const handleAddSubscription = (newSubData: Omit<Subscription, 'id' | 'icon'>) => {
        const newSubscription: Subscription = {
        ...newSubData,
        id: Date.now().toString(), // Generate a unique ID
        icon: 'credit-card',       // Default icon string
        };
        setSubscriptions(prev => [...prev, newSubscription]);
    };

    const handleUpdateSubscription = (updatedSubData: Omit<Subscription, 'id' | 'icon'>) => {
        if (!editingSubscription) return;
        
        setSubscriptions(prev => 
        prev.map(sub => 
            sub.id === editingSubscription.id 
            ? { ...sub, ...updatedSubData } 
            : sub
        )
        );
        setEditingSubscription(null);
    };

    const handleDeleteSubscription = (id: string | number) => {
        setSubscriptions(prev => prev.filter(sub => sub.id !== id));
    };

    return {
        subscriptions,
        isModalOpen,
        setIsModalOpen,
        editingSubscription,
        setEditingSubscription,
        handleAddSubscription,
        handleUpdateSubscription,
        handleDeleteSubscription,
    };
}
export default UseSubscriptions
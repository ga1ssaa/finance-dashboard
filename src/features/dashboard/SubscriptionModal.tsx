import { useState } from "react";
import { X } from "lucide-react";
import type { Subscription } from "../../types/finance";

interface SubscriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (subscription: Omit<Subscription, 'id' | 'icon'>) => void;
    initialData?: Subscription | null;
}

function SubscriptionModal({ isOpen, onClose, onSubmit, initialData }: SubscriptionModalProps) {

    // Initialize state directly from initialData (if it exists)
    const [serviceName, setServiceName] = useState(initialData?.serviceName || '');
    
    const [amount, setAmount] = useState(initialData?.amount?.toString() || '');

    const [nextPaymentDate, setNextPaymentDate] = useState(
        initialData?.nextPaymentDate || new Date().toISOString().split('T')[0]
    );

    const [status, setStatus] = useState<'active' | 'paused'>(initialData?.status || 'active');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!serviceName || !amount || !nextPaymentDate) return;

        onSubmit({serviceName,amount: parseFloat(amount),nextPaymentDate,status});
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-xl overflow-hidden transition-colors">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-700">
                    <h2 className="font-serif text-xl font-bold text-slate-800 dark:text-white">
                        {initialData ? 'Edit Subscription' : 'Add Subscription'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>

                    {/* Modal Body / Form */}
                    <form onSubmit={handleSubmit} className="p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Service Name
                            </label>
                            <input
                            type="text"
                            required
                            placeholder="e.g., Netflix, Spotify"
                            value={serviceName}
                            onChange={(e) => setServiceName(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 dark:text-white transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Monthly Amount
                            </label>
                            <input
                            type="number"
                            required
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 dark:text-white transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Next Payment Date
                            </label>
                            <input
                            type="date"
                            required
                            value={nextPaymentDate}
                            onChange={(e) => setNextPaymentDate(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 dark:text-white transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Status
                            </label>
                            <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value as 'active' | 'paused')}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 dark:text-white transition-colors"
                            >
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            </select>
                        </div>

                        {/* Form Actions */}
                        <div className="flex items-center justify-end gap-3 pt-4">
                            <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                            >
                            Cancel
                            </button>
                            <button
                            type="submit"
                            className="px-4 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm cursor-pointer"
                            >
                            {initialData ? 'Save Changes' : 'Add Subscription'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        );
}
export default SubscriptionModal
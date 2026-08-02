import { CreditCard, MonitorPlay, Music, Dumbbell, Smartphone, Pencil, Trash2 } from "lucide-react";
import type { Subscription } from "../../types/finance";
import { useSettings } from "../../hooks/useSettings"; 

interface ActiveSubscriptionsProps {
    subscriptions: Subscription[];
    onEdit: (subscription: Subscription) => void;
    onDelete: (id: string | number) => void;
};

function ActiveSubscriptions({subscriptions, onEdit, onDelete}: ActiveSubscriptionsProps){
    const { formatAmount } = useSettings();
    // Calculating total monthly fixed costs
    const totalMonthly = subscriptions 
        .filter((sub) => sub.status === 'active')
        .reduce((sum, sub) => sum + sub.amount, 0);

    // Helper function to render the correct icon based on the service name
    const renderIcon = (name: string) => {
        const lowerName = name.toLowerCase();
        if(lowerName.includes('netflix') || lowerName.includes('cinema')) return <MonitorPlay size={20}/>;
        if(lowerName.includes('spotify') || lowerName.includes('music')) return <Music size={20}/>;
        if(lowerName.includes('fitness') || lowerName.includes('gym')) return <Dumbbell size={20}/>;
        if(lowerName.includes('mobile') || lowerName.includes('internet')) return <Smartphone size={20}/>;

        return <CreditCard size={20}/>
    }

    return(
        <div className="w-full bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col transition-colors duration-200">
            {/* Header Section */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-white transition-colors">
                        Active Subscriptions
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Fixed monthly costs
                    </p>
                </div>
                <div className="text-right">
                    <p className="font-bold text-xl text-slate-800 dark:text-white">
                        {formatAmount(totalMonthly)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        / month
                    </p>
                </div>
            </div>

            {/* Subscriptions List Section */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                {subscriptions.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400 text-sm">
                        No Active Subscriptions
                    </div>
                ) : (
                    subscriptions.map((sub) => (
                        <div
                            key={sub.id}
                            className={`group flex items-center justify-between p-3 rounded-xl border ${
                                sub.status === 'active' 
                                ? "border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50"
                                : "border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/20 opacity-60"
                            }`}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                    {renderIcon(sub.serviceName)}
                                </div>
                                <div>
                                    <p className="font-serif font-medium text-slate-800 dark:text-white">
                                        {sub.serviceName}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Next: {new Date(sub.nextPaymentDate).toLocaleDateString()}                                        
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="text-right">
                                    <p className="font-bold text-slate-800 dark:text-white">
                                        {formatAmount(sub.amount)}
                                    </p>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                        sub.status === 'active'
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                                    }`}>
                                        {sub.status}
                                    </span>
                                </div>

                                <div>
                                    <button
                                        onClick={() => onEdit(sub)}
                                        className="text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer p-1"
                                        title="Edit subscription"
                                    >
                                        <Pencil size={18} />
                                    </button>

                                    <button
                                        onClick={() => onDelete(sub.id)}
                                        className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer p-1"
                                        title="Delete subscription"
                                    >
                                        <Trash2 size={18} />
                                    </button>    
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default ActiveSubscriptions;
import { AlertTriangle, X } from "lucide-react";

interface ConfirmResetModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
};

function ConfirmResetModal({isOpen, onClose, onConfirm}: ConfirmResetModalProps){
    if(!isOpen) return null;

    return(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-xl overflow-hidden transition-colors border border-red-100 dark:border-red-900/30">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-300 dark:border-slate-600">
                    <h2 className="font-serif text-xl font-bold text-red-600 dark:text-red-500 flex items-center gap-2">
                        <AlertTriangle size={24}/>
                        Reset All Data
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
                    >
                        <X size={20}/>
                    </button>
                </div>

                {/* Body */}
                <div className="font-serif p-6 space-y-4">
                    <p className="text-slate-600 dark:text-slate-300">
                        Are you sure you want to delete all your financial data?
                    </p>
                    <ul className="text-sm text-slate-500 dark:text-slate-400 list-disc list-inside space-y-1">
                        <li>All transactions will be permanently deleted.</li>
                        <li>All subscriptions will be removed.</li>
                        <li>Your budget settings will be reset to default.</li>
                    </ul>
                    <p className="text-sm font-bold text-red-600 dark:text-red-400 mt-4">
                        This action cannot be undone.
                    </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 p-6 pt-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm cursor-pointer"
                    >
                        Yes, Delete everything
                    </button>
                </div>
            </div>
        </div>
    );
};
export default ConfirmResetModal
import { AlertTriangle, X } from "lucide-react";

interface ConfirmResetModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
};

function ConfirmResetModal({isOpen, onClose, onConfirm}: ConfirmResetModalProps){
    if(!isOpen) return null;

    return(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50">
            <div className="bg-surface rounded-modal max-h-[90dvh] overflow-y-auto w-full max-w-md shadow-overlay transition-colors border border-red-100 dark:border-red-900/30">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-control">
                    <h2 className="font-sans text-xl font-bold text-red-600 dark:text-red-500 flex items-center gap-2">
                        <AlertTriangle size={24}/>
                        Reset All Data
                    </h2>
                    <button
                        onClick={onClose}
                        aria-label="Close reset confirmation"
                        className="p-2 rounded-control hover:bg-hover dark:hover:bg-hover text-secondary transition-colors cursor-pointer"
                    >
                        <X size={20}/>
                    </button>
                </div>

                {/* Body */}
                <div className="font-sans p-6 space-y-4">
                    <p className="text-secondary">
                        Are you sure you want to delete all your financial data?
                    </p>
                    <ul className="text-sm text-secondary list-disc list-inside space-y-1">
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
                        className="px-4 py-2.5 text-sm font-medium text-secondary hover:bg-hover dark:hover:bg-hover rounded-control transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-control transition-colors shadow-none cursor-pointer"
                    >
                        Yes, Delete everything
                    </button>
                </div>
            </div>
        </div>
    );
};
export default ConfirmResetModal
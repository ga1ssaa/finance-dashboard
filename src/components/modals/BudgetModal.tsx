import { useState } from "react";
import { X } from "lucide-react";

interface BudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (newIncome: number) => void;
    currentIncome: number;
}

function BudgetModal({isOpen, onClose, onSubmit, currentIncome}: BudgetModalProps){

    const [income, setIncome] = useState(currentIncome.toString());

    if(!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!income) return;

        onSubmit(parseFloat(income));
        onClose();
    };

    return(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-xl overflow-hidden transition-colors">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-300 dark:border-slate-600">
                    <h2 className="font-serif text-xl font-bold text-slate-800 dark:text-white">
                        Set Monthly Income
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors cursor-pointer"
                    >
                        <X size={20}/>
                    </button>
                </div>

                {/* Modal Body / Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Monthly Income ($)
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            This amount will be used to calculate your 50/30/20 budget limits.
                        </p>
                        <input 
                            type="number" 
                            required
                            min="0"
                            step="1"
                            placeholder="e.g., 5000"
                            value={income}
                            onChange={(e) => setIncome(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800 dark:text-white transition-colors"
                        />
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
                            Save Budget
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );

}
export default BudgetModal
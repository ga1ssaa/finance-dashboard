import { useState } from "react"
import { Trash2 } from "lucide-react"
import ConfirmResetModal from "../../components/modals/ConfirmResetModal"
import { useSettings } from "../../hooks/useSettings"

function DangerZone(){
    const [isModalOpen, setIsModalOpen] = useState(false);
    const {resetAllData} = useSettings();

    return(
        <div>
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-red-200 dark:border-red-900/30 shadow-sm transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                            <Trash2 size={20} className="text-red-500"/>
                            Danger Zone
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Permanently delete all transactions, subscriptions, and budget settings from this browser.
                        </p>
                    </div>

                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="px-4 py-2.5 text-sm font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                    >
                        Reset All Data
                    </button>
                </div>
            </div>

            <ConfirmResetModal 
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onConfirm={resetAllData}
            />
        </div>
    );
}
export default DangerZone
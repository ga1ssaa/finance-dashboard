import { Trash2 } from "lucide-react"

function DangerZone(){

    return(
        <div>
            <div className="bg-surface rounded-card p-6 border border-red-200 dark:border-red-900/30 shadow-none transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-lg text-primary flex items-center gap-2">
                            <Trash2 size={20} className="text-red-500"/>
                            Danger Zone
                        </h3>
                        <p className="text-sm text-secondary mt-1">
                            Reset is unavailable for API-managed data. Existing browser data is left untouched.
                        </p>
                    </div>

                    <button
                        disabled title="Unavailable for API-managed data"
                        className="px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-control transition-colors cursor-pointer whitespace-nowrap"
                    >
                        Reset All Data
                    </button>
                </div>
            </div>

        </div>
    );
}
export default DangerZone
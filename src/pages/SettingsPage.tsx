import DangerZone from "../features/settings/DangerZone";
import { Moon, Sun } from "lucide-react";

interface SettingsPageProps {
    isDarkMode?: boolean;
    toggleTheme?: () => void;
}

function SettingsPage({isDarkMode, toggleTheme}: SettingsPageProps){
    return(
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                        Settings
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                        Manage your app preferences and data
                    </p>
                </div>

                {/* Theme Toggle */}
                {toggleTheme && (
                    <button
                        onClick={toggleTheme}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer"
                        title="Toggle Dark Mode"
                    >
                        {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                )}
            </div>

            <div className="max-w-3xl space-y-6">
                <DangerZone />
            </div>
        </div>
    );
}
export default SettingsPage
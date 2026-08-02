import { useRef } from "react";
import DangerZone from "../features/settings/DangerZone";
import { Moon, Sun, Download, Upload, DollarSign } from "lucide-react";
import { useSettings, CURRENCY_SYMBOLS, type Currency } from "../hooks/useSettings";

interface SettingsPageProps {
    isDarkMode?: boolean;
    toggleTheme?: () => void;
}

function SettingsPage({ isDarkMode, toggleTheme }: SettingsPageProps) {
    const { currency, setCurrency, exportData, importData } = useSettings();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
        importData(file);
        }
    };

    return (
        <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                    Settings
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                    Manage your app preferences and data backups
                </p>
            </div>

                {toggleTheme && (
                <button
                    onClick={toggleTheme}
                    className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer w-fit"
                    title="Toggle Dark Mode"
                >
                    {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                )}
        </div>

        <div className="max-w-4xl space-y-6">
            {/* Currency Preference */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                            <DollarSign size={20} className="text-blue-500" />
                            Currency Symbol
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Choose the main currency for your application interface
                        </p>
                    </div>

                    <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white font-bold border border-slate-200 dark:border-slate-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                    {(Object.keys(CURRENCY_SYMBOLS) as Currency[]).map((curr) => (
                        <option key={curr} value={curr}>
                        {curr} ({CURRENCY_SYMBOLS[curr]})
                        </option>
                    ))}
                    </select>
                </div>
            </div>

            {/* Backup & Restore Data */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors space-y-4">
            <div>
                <h3 className="font-semibold text-lg text-slate-800 dark:text-white">
                Data Backup & Restore
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Export your data to JSON backup file or restore from a previous file.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={exportData}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors cursor-pointer"
                            >
                            <Download size={18} />
                            Export Backup
                        </button>

                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors cursor-pointer"
                            >
                            <Upload size={18} />
                            Import Backup
                        </button>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>
                </div>

                {/* Danger Zone */}
                <DangerZone />
            </div>
        </div>
    );
}
export default SettingsPage
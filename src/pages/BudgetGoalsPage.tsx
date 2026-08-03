import { useState } from "react";
import { useBudget } from "../hooks/useBudget";
import BudgetGoalsWidget from "../features/budget/BudgetGoalsWidget";
import BudgetModal from "../components/modals/BudgetModal";
import { Moon, Sun, Settings } from "lucide-react";

interface BudgetGoalsPageProps {
    isDarkMode?: boolean;
    toggleTheme?: () => void;
}

function BudgetGoalsPage({ isDarkMode, toggleTheme }: BudgetGoalsPageProps) {
    const { monthlyIncome, setMonthlyIncome, spentData } = useBudget();

    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleSaveIncome = (newIncomeInUSD: number) => {
        setMonthlyIncome(newIncomeInUSD);
    };

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
                        Budget and Goals
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
                        Track your 50/30/20 rule limits and financial targets
                    </p>
                </div>

                {/* Theme Toggle and Set Budget Button */}
                <div className="flex items-center gap-3">
                    {toggleTheme && (
                        <button
                            onClick={toggleTheme}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer"
                            title="Toggle Dark Mode"
                        >
                            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                        </button>
                    )}

                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm cursor-pointer transition-colors w-fit"
                    >
                        <Settings size={18} />
                        <span>Set Budget</span>
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="w-full">
                <BudgetGoalsWidget 
                    monthlyIncome={monthlyIncome}
                    spentData={spentData}
                />
            </div>

            {/* Modal */}
            <BudgetModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSaveIncome}
                currentIncome={monthlyIncome}
            />
        </div>
    );
}
export default BudgetGoalsPage;
import { useSettings } from "../hooks/useSettings";
import ResourceStatus from "../components/ResourceStatus";
import { useState } from "react";
import { useBudget } from "../hooks/useBudget";
import BudgetGoalsWidget from "../features/budget/BudgetGoalsWidget";
import BudgetModal from "../components/modals/BudgetModal";
import { Settings } from "lucide-react";

function BudgetGoalsPage() {
    const { monthlyIncome, spentData, data, saveBudget, loading, error, retry } = useBudget();

    const {preferenceLoading, preferenceError} = useSettings();
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <div className="ui-page">
            {/* Page Header */}
            <div className="ui-page-header">
                <div>
                    <h2 className="ui-page-title">
                        Budget and Goals
                    </h2>
                    <p className="ui-page-description">
                        Track your 50/30/20 rule limits and financial targets
                    </p>
                </div>

                {/* Set Budget Button */}
                <div className="flex items-center gap-3">
                    <button
                        disabled={!data || preferenceLoading || Boolean(preferenceError)} onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-accent-ink px-4 py-2.5 rounded-control font-semibold text-sm shadow-none cursor-pointer transition-colors w-fit"
                    >
                        <Settings size={18} />
                        <span>Set Budget</span>
                    </button>
                </div>
            </div>

            <ResourceStatus loading={loading} error={error} retry={retry} />
            {/* Main Content Area */}
            {!loading && !error && data && (
                <div className="w-full">
                    {monthlyIncome === 0 && spentData.needs === 0 && spentData.wants === 0 && spentData.savings === 0 ? (
                        <div className="ui-empty-state">
                            <div>
                                <p className="font-medium">Build your monthly plan.</p>
                                <p className="mt-1 text-sm text-secondary">Manually allocate income to needs, wants and savings.</p>
                            </div>
                            <button type="button" disabled={preferenceLoading || Boolean(preferenceError)} onClick={() => setIsModalOpen(true)} className="ui-primary-action">Set Budget</button>
                        </div>
                    ) : <BudgetGoalsWidget monthlyIncome={monthlyIncome} spentData={spentData} />}
                </div>
            )}

            {/* Modal */}
            {data && isModalOpen && <BudgetModal
                key="open-budget"
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={saveBudget}
                currentBudget={data}
            />}
        </div>
    );
}
export default BudgetGoalsPage;

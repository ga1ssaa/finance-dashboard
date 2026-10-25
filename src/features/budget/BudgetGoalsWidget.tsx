import { Target ,AlertTriangle, Coffee, Home, PiggyBank } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";

interface BudgetGoalsWidgetProps {

    monthlyIncome: number;
    spentData: {
        needs: number,
        wants: number,
        savings: number,

    };
}
function BudgetGoalsWidget({monthlyIncome, spentData}: BudgetGoalsWidgetProps){

    const {formatAmount} = useSettings();

    const needsSpent = spentData?.needs ?? 0;
    const wantsSpent = spentData?.wants ?? 0;
    const savingsSpent = spentData?.savings ?? 0;

    const categories = [
        {
            id: "needs",
            label: "Needs (50%)",
            description: "Housing, food and transport",
            icon: <Home size={18}/>,
            limit: monthlyIncome * 0.50,
            spent: needsSpent,
            baseColor: "bg-accent",
        },
        {
            id: "wants",
            label: "Wants (30%)",
            description: "Entertainment and Shopping",
            icon: <Coffee size={18}/>,
            limit: monthlyIncome * 0.30,
            spent: wantsSpent,
            baseColor: "bg-accent",
        },
        {
            id: "savings",
            label: "Savings (20%)",
            description: "Emergency fund, stocks",
            icon: <PiggyBank size={18}/>,
            limit: monthlyIncome * 0.20,
            spent: savingsSpent,
            baseColor: "bg-emerald-500 dark:bg-emerald-400",
        },
    ];

    return (
        <div className="ui-panel">
            {/* Widget Header */}
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h3 className="font-semibold text-lg text-primary flex items-center gap-2 transition-colors">
                        <Target size={20} className="text-accent" />
                        Budget and Goals (50/30/20)
                    </h3>
                    <p className="text-sm text-secondary mt-1">
                        Based on your {formatAmount(monthlyIncome)} monthly income
                    </p>
                </div>
            </div>

            {/* Categories Progress Bars */}
            <div className="space-y-5">
                {categories.map((person) => {
                    // Calculate percentages
                    const rawPercent = person.limit > 0 ? (person.spent / person.limit) * 100 : 0;
                    const displayPercent = Math.min(rawPercent, 100);

                    // Determine color based on limits
                    let barColor = person.baseColor;
                    let isWarning = false;
                    let isDanger = false;

                    if (rawPercent >= 100) {
                        barColor = "bg-red-500 dark:bg-red-400";
                        isDanger = true;
                    } else if (rawPercent >= 80) {
                        barColor = "bg-amber-400 dark:bg-amber-400";
                        isWarning = true;
                    }

                    return (
                        <div key={person.id} className="space-y-2">
                            {/* Category Header */}
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="shrink-0 p-2 bg-muted rounded-control text-secondary">
                                        {person.icon}
                                    </div>
                                    <div>
                                        <p className="font-medium text-primary flex items-center gap-2">
                                            {person.label}
                                            {isDanger && <AlertTriangle size={14} className="text-red-500" />}
                                        </p>
                                        <p className="text-xs text-secondary">
                                            {person.description}
                                        </p>
                                    </div>
                                </div>

                                {/* Amount Spent vs Limit */}
                                <div className="min-w-0 text-right [overflow-wrap:anywhere]">
                                    <p className={`font-semibold ${isDanger ? "text-red-500" : "text-primary"}`}>
                                        {formatAmount(person.spent)}{" "}
                                        <span className="text-secondary text-sm font-normal">
                                            / {formatAmount(person.limit)}
                                        </span>
                                    </p>
                                    <p className={`text-xs ${isDanger ? "text-red-500 font-semibold" : isWarning ? "text-amber-500 font-semibold" : "text-secondary"}`}>
                                        {rawPercent.toFixed(1)}% used
                                    </p>
                                </div>
                            </div>

                            {/* Progress Bar Track */}
                            <div className="w-full bg-muted dark:bg-muted/50 rounded-control h-1.5 overflow-hidden">
                                <div
                                    className={`h-full rounded-control ${barColor}`}
                                    style={{ width: `${displayPercent}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default BudgetGoalsWidget;
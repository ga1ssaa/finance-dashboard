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

    const categories = [
        {
            id: "needs",
            label: "Needs (50%)",
            description: "Housing, food and transport",
            icon: <Home size={18}/>,
            limit: monthlyIncome * 0.50,
            spent: spentData.needs,
            baseColor: "bg-blue-500 dark:bg-blue-400",
        },
        {
            id: "wants",
            label: "Wants (30%)",
            description: "Entertainment and Shopping",
            icon: <Coffee size={18}/>,
            limit: monthlyIncome * 0.30,
            spent: spentData.wants,
            baseColor: "bg-indigo-500 dark:bg-indigo-400",
        },
        {
            id: "savings",
            label: "Savings (20%)",
            description: "Emergency fund, stocks",
            icon: <PiggyBank size={18}/>,
            limit: monthlyIncome * 0.20,
            spent: spentData.savings,
            baseColor: "bg-emerald-500 dark:bg-emerald-400",
        },
    ];

    return(
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm transition-colors duration-200">

            {/* Widget Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="font-semibold text-lg text-slate-800 dark:text-white flex items-center gap-2 transition-colors">
                        <Target size={20} className="text-blue-500"/>
                        Budget and Goals (50/30/20)
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Based on your {formatAmount(monthlyIncome)} monthly income
                    </p>
                </div>
            </div>

            {/* Categories Progress Bars */}
            <div className="space-y-6">
                {categories.map((person) => {
                    // Calculate percentages
                    const rawPercent = person.limit > 0 ? (person.spent / person.limit) * 100 : 0;
                    const displayPercent = Math.min(rawPercent, 100);
                    
                    // Determine color based on limits (Warning at 80%, Danger at 100%)
                    let barColor = person.baseColor;
                    let isWarning = false;
                    let isDanger = false;
                    
                    if(rawPercent >= 100){
                        barColor = "bg-red-500 dark:bg-red-400";
                        isDanger = true;
                    }
                    else if(rawPercent >= 80){
                        barColor = "bg-amber-400 dark:bg-amber-400";
                        isWarning = true;
                    }

                    return(
                        <div key={person.id} className="space-y-2">
                            {/* Category Header */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300">
                                        {person.icon}
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-800 dark:text-white flex items-center gap-2">
                                            {person.label}
                                            {/* Show alert icon if limit is exceeded */}
                                            {isDanger && <AlertTriangle size={14} className="text-red-500"/>}
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {person.description}
                                        </p>
                                    </div>
                                </div>
                                {/* Amount Spent vs Limit */}
                                <div className="text-right">
                                    <p className={`font-bold ${isDanger ? "text-red-500" : "text-slate-800 dark:text-white"}`}>
                                        {formatAmount(person.spent)} <span className="text-slate-400 dark:text-slate-500 text-sm font-normal ">/ {formatAmount(person.limit)}</span>
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {rawPercent.toFixed(1)}% used
                                    </p>
                                </div>
                            </div>  

                            {/* Progress Bar Track */}
                            <div className="w-full bg-slate-100 dark:bg-slate-700/50 rounded-full h-3 overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
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
export default BudgetGoalsWidget
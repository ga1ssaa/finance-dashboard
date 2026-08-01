import { useMemo } from "react";

export interface Insight {
    id: string;
    type: "warning" | "success" | "tip" | "info";
    title: string;
    message: string;
}

interface UseInsightsProps {
    monthlyIncome: number;
    spentData: {
        needs: number
        wants: number
        savings: number
    };
    transactions?: Array<{
        id?: string | number;
        amount: number;
        category?: string;
        type?: string
    }>;
}

export function useInsights({monthlyIncome, spentData, transactions = []}: UseInsightsProps){
    const insights = useMemo<Insight[]>(() => {
        const results: Insight[] = [];
        const totalSpent = spentData.needs + spentData.wants;

        // 50/30/20 rule
        const needsLimit = monthlyIncome * 0.5;
        const wantsLimit = monthlyIncome * 0.3;
        const savingsTarget = monthlyIncome * 0.2;


        const isNeedsOver = spentData.needs > needsLimit;
        const isWantsOver = spentData.wants > wantsLimit;
        const hasExpenseProblems = isNeedsOver || isWantsOver || (totalSpent > monthlyIncome * 0.8);

        // Critical Zone (>90%)
        if (totalSpent >= monthlyIncome * 0.9 && monthlyIncome > 0) {
            results.push({
                id: "budget-danger",
                type: "warning",
                title: "Critical Budget Alert",
                message: `You've spent over ${((totalSpent / monthlyIncome) * 100).toFixed(0)}% of your monthly income. Consider holding off on non-essential purchases.`,
            })
        }

        // Warning Alert (80%-90%)
        else if(totalSpent >= monthlyIncome * 0.8 && monthlyIncome > 0){
            results.push({
                id: "budget-warning",
                type: "warning",
                title: "Approaching Budget Limit",
                message: "You've used over 80% of your total budget. Keep an eye on your remaining expenses this month.",
            });
        };

        // Wants - 30
        if (isWantsOver && monthlyIncome > 0) {
            const overspent = spentData.wants - wantsLimit;
            results.push({
                id: "wants-overspend",
                type: "warning",
                title: "Wants Limit Exceeded",
                message: `Your spending on entertainment and shopping exceeds the 30% guideline by $${overspent.toFixed(0)}.`,
            });
        };

        if (hasExpenseProblems && monthlyIncome > 0){
            results.push({
                id: "savings-hold",
                type: "warning",
                title: "Prioritize Essential Expenses",
                message: "Your Needs or Wants are currently over budget. Don't worry about saving right now, focus on covering your essential expenses and balancing your limits first!",
            });
        } 

        // Savings - 20
        else if (spentData.savings >= savingsTarget && monthlyIncome > 0){
            results.push({
                id: "savings-success",
                type: "success",
                title: "Savings Goal Reached! 🎉",
                message: `You've saved $${spentData.savings.toFixed(0)}, hitting your 20% target under the 50/30/20 rule. Great job!`,
            });
        } 

        else if (monthlyIncome > 0){
            const remainingToSave = savingsTarget - spentData.savings;
                results.push({
                id: "savings-tip",
                type: "tip",
                title: "Savings Target Tip",
                message: `Save an additional $${remainingToSave.toFixed(0)} to reach your 20% financial goal for this month.`,
            });
        }

        if (transactions.length === 0) {
        results.push({
                id: "no-transactions",
                type: "info",
                title: "Start Tracking Your Spending",
                message: "Add your recent transactions to unlock personalized spending habits and AI analysis.",
            });
        };

        return results
    }, [monthlyIncome, spentData, transactions]);

    return {insights}
}

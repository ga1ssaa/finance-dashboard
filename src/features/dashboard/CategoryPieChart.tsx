import { useMemo } from "react"
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Transaction } from "../../types/finance"

interface CategoryPieChartProps {
    transactions: Transaction[];
}

// Colors for Recharts
const COLORS = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#6366f1', '#ec4899'];

function CategoryPieChart({transactions}: CategoryPieChartProps){

    //Filtering only Expenses
    const chartData = useMemo(() => {
        const expenses = transactions.filter((t) => t.type === 'expense'); 

        //Groupping sums by categories
        const totals = expenses.reduce((acc, t) => {
            acc[t.category] = (acc[t.category] || 0) + t.amount;
            return acc;
        }, {} as Record<string, number>);

        //Converting object ot array, which will be appropriate for Recharts
        return Object.keys(totals).map((category) => ({
            name: category,
            value: totals[category], 
        }));
    }, [transactions]);

    return(
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm h-80 flex flex-col">
            <h3 className="font-serif text-lg font-semibold text-slate-800 mb-4">
                Expenses by Category
            </h3>
            <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data = {chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                        >
                            {chartData.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]}/>
                            ))}
                        </Pie>
                        <Tooltip formatter={(value) => `$${value}`} />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div> 
    );

    

}
export default CategoryPieChart
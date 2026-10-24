import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSettings } from "../../hooks/useSettings";

interface CategoryPieChartProps {
    categories: {category:string; amount_usd:string}[];
}

// Colors for Recharts
const COLORS = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#6366f1', '#ec4899'];

function CategoryPieChart({categories}: CategoryPieChartProps){

    const {formatAmount} = useSettings();

    const chartData = categories.map(item => ({name:item.category, value:Number(item.amount_usd)}));

    return(
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 min-h-[420px] md:h-80 flex flex-col">
            <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-white mb-4 transition-colors">
                Expenses by Category
            </h3>

            <div className="flex-1 min-h-0">
                {chartData.length === 0 ? <p className="text-slate-400 text-sm">No expenses in this period.</p> : <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data = {chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                        >
                            {chartData.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]}/>
                            ))}
                        </Pie>
                        <Tooltip 
                            formatter={(value) => formatAmount(Number(value))}
                            contentStyle={{
                                backgroundColor: '#1e293b', 
                                border: 'none',
                                borderRadius: '8px',
                                color: '#f8fafc', // slate-50
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                            }}
                        />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>}
            </div>
        </div> 
    );
}
export default CategoryPieChart
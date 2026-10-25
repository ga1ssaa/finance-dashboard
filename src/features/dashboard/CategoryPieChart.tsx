import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useSettings } from '../../hooks/useSettings';

const COLORS = ['rgb(var(--accent))', ...[2, 3, 4, 5, 6].map(index => `rgb(var(--chart-${index}))`)];

export default function CategoryPieChart({ categories }: { categories: { category: string; amount_usd: string }[] }) {
    const { formatAmount } = useSettings();
    const data = categories.map(item => ({ name: item.category, value: Number(item.amount_usd) }));
    return (
        <div className="min-w-0">
            <h3 className="text-sm font-medium text-primary">Expenses by category</h3>
            {!data.length ? <p className="mt-3 text-sm text-secondary">No expenses in this period.</p> : (
                <div className="mt-3 grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-4">
                    <div className="h-28 w-28" aria-hidden="true">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart accessibilityLayer={false}>
                                <Pie data={data} dataKey="value" innerRadius={35} outerRadius={51} paddingAngle={2} stroke="none" isAnimationActive={false}>
                                    {data.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}
                                </Pie>
                                <Tooltip formatter={value => formatAmount(Number(value))} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border-subtle))', borderRadius: 'var(--radius-card)', color: 'rgb(var(--primary))' }} itemStyle={{ color: 'rgb(var(--primary))' }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <ul aria-label="Expense amounts by category" className="min-w-0 space-y-2">
                        {categories.map((item, index) => (
                            <li key={item.category} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                                <span className="min-w-0 text-secondary [overflow-wrap:anywhere]"><span aria-hidden="true" className="mr-2 inline-block h-2 w-2" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{item.category}</span>
                                <span className="min-w-0 text-right font-medium text-primary [overflow-wrap:anywhere]">{formatAmount(item.amount_usd)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

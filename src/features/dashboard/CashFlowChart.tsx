import { BarChart, Bar, Cell, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import type { DashboardRecord } from '../../api/client';
import { useSettings } from '../../hooks/useSettings';

export default function CashFlowChart({ summary, period }: { summary: DashboardRecord; period: string }) {
    const { formatAmount } = useSettings();
    const data = [{ name: 'Income', value: Number(summary.income_usd) }, { name: 'Expenses', value: Number(summary.expenses_usd) }];
    return (
        <figure className="min-w-0">
            <div role="img" aria-label={`Income versus expenses, ${period}`} aria-describedby="cash-flow-values" className="h-[220px] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ top: 12, right: 16, bottom: 12, left: 0 }} accessibilityLayer={false}>
                        <CartesianGrid horizontal={false} stroke="rgb(var(--border-subtle))" strokeDasharray="3 3" />
                        <XAxis type="number" hide domain={[0, 'dataMax']} />
                        <YAxis dataKey="name" type="category" width={76} tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--secondary))', fontSize: 12 }} />
                        <Tooltip formatter={value => formatAmount(Number(value))} cursor={{ fill: 'rgb(var(--hover))' }} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border-subtle))', borderRadius: 'var(--radius-card)', color: 'rgb(var(--primary))' }} itemStyle={{ color: 'rgb(var(--primary))' }} />
                        <Bar dataKey="value" name="Amount" radius={[0, 4, 4, 0]} barSize={28} isAnimationActive={false}>
                            <Cell fill="rgb(var(--accent))" /><Cell fill="rgb(var(--chart-2))" />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <figcaption id="cash-flow-values" className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-secondary">
                <span>Income <strong className="font-medium text-primary">{formatAmount(summary.income_usd)}</strong></span>
                <span>Expenses <strong className="font-medium text-primary">{formatAmount(summary.expenses_usd)}</strong></span>
            </figcaption>
        </figure>
    );
}

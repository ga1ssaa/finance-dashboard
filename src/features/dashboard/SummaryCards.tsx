import type { DashboardRecord } from '../../api/client';
import { useSettings } from '../../hooks/useSettings';

export default function SummaryCards({ summary }: { summary: DashboardRecord }) {
    const { formatAmount } = useSettings();
    return (
        <dl className="grid min-w-0 gap-6 rounded-card border border-subtle bg-surface p-5 sm:p-6 md:grid-cols-[1.4fr_1fr_1fr]">
            <div className="min-w-0 border-b border-subtle pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
                <dt className="text-sm font-medium text-secondary">Total Balance</dt>
                <dd className="mt-2"><span className="block text-[clamp(2rem,4vw,2.75rem)] font-bold leading-tight tracking-tight text-primary [overflow-wrap:anywhere]">{formatAmount(summary.balance_usd)}</span><span className="mt-2 block text-xs text-secondary">From recorded transactions in this period</span></dd>
            </div>
            <div className="min-w-0 self-center">
                <dt className="text-sm font-medium text-secondary">Total Income</dt>
                <dd className="mt-2 text-2xl font-semibold text-accent [overflow-wrap:anywhere]">{formatAmount(summary.income_usd)}</dd>
            </div>
            <div className="min-w-0 self-center">
                <dt className="text-sm font-medium text-secondary">Total Expenses</dt>
                <dd className="mt-2 text-2xl font-semibold text-primary [overflow-wrap:anywhere]">{formatAmount(summary.expenses_usd)}</dd>
            </div>
        </dl>
    );
}

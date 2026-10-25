import { Link } from 'react-router-dom';
import type { BudgetRecord } from '../../api/client';
import { useSettings } from '../../hooks/useSettings';
import ResourceStatus from '../../components/ResourceStatus';
import { budgetRows } from './overviewData';

export interface OverviewBudget {
    data: BudgetRecord | null;
    loading: boolean;
    error: string;
    retry: () => void;
    monthlyIncome: number;
    spentData: { needs: number; wants: number; savings: number };
}

export default function BudgetOverview({ budget }: { budget: OverviewBudget }) {
    const { formatAmount } = useSettings();
    const rows = budgetRows(budget.monthlyIncome, budget.spentData);
    const configured = budget.monthlyIncome > 0 || rows.some(row => row.amount > 0);
    return (
        <section aria-labelledby="budget-overview-title" className="overview-section">
            <div className="overview-section-heading">
                <div><h2 id="budget-overview-title" className="text-lg font-semibold">Budget overview</h2><p className="mt-1 text-xs text-secondary">Monthly 50/30/20 plan · Manual entries, independent of transactions</p></div>
                <Link to="/budget" className="overview-text-link">Budget and Goals</Link>
            </div>
            <ResourceStatus loading={budget.loading} error={budget.error} retry={budget.retry} />
            {!budget.loading && !budget.error && budget.data && (configured ? (
                <>
                    <p className="mb-5 text-sm text-secondary">Manual monthly income <span className="font-medium text-primary">{formatAmount(budget.monthlyIncome)}</span></p>
                    <div className="grid min-w-0 gap-6 md:grid-cols-3">
                        {rows.map(row => {
                            const state = row.key === 'savings' ? 'normal' : row.percent !== null && row.percent >= 100 ? 'over' : row.percent !== null && row.percent >= 80 ? 'warning' : 'normal';
                            return (
                                <div key={row.key} className="min-w-0">
                                    <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-medium">{row.label}</h3><span className="text-xs text-secondary">{row.share * 100}% allocation</span></div>
                                    <p className="mt-2 font-semibold text-primary [overflow-wrap:anywhere]">{formatAmount(row.amount)} <span className="text-xs font-normal text-secondary">/ {formatAmount(row.limit)}</span></p>
                                    <progress className="overview-progress mt-3" data-state={state} max={100} value={Math.min(row.percent ?? 0, 100)} aria-label={`${row.label} manual allocation`} aria-valuetext={row.percent === null ? 'No income target set' : `${row.percent.toFixed(1)}% of allocation`} />
                                    <p className="mt-2 text-xs text-secondary">{row.percent === null ? 'Set monthly income to establish a target' : `${row.percent.toFixed(1)}% ${row.key === 'savings' ? 'saved toward target' : 'used'}${state === 'over' ? ' · At or over allocation' : state === 'warning' ? ' · Near allocation' : ''}`}</p>
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : <div className="ui-empty-state"><div><p className="font-medium">Set your monthly budget.</p><p className="mt-1 text-sm text-secondary">Enter income, needs, wants and savings to track your manual plan.</p></div><Link to="/budget" className="ui-primary-action">Set Budget</Link></div>)}
        </section>
    );
}

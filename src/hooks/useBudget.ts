import { request } from '../api/client';
import type { BudgetRecord } from '../api/client';
import { useResource } from './useResource';
import { useFinance } from '../state/financeStore';
export function useBudget() {
    const resource = useResource<BudgetRecord>('/budget');
    const { refresh } = useFinance();
    const saveBudget = async (patch: Partial<BudgetRecord>) => { await request('/budget', { method: 'PATCH', body: JSON.stringify(patch) }); refresh(); };
    return { ...resource, monthlyIncome: Number(resource.data?.monthly_income_usd || '0'), spentData: { needs: Number(resource.data?.needs_spent_usd || '0'), wants: Number(resource.data?.wants_spent_usd || '0'), savings: Number(resource.data?.savings_usd || '0') }, setMonthlyIncome: (value: string) => saveBudget({ monthly_income_usd: value }), saveBudget };
}

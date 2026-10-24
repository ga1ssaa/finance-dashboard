export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1').replace(/\/$/, '');
function validateLocalApi() {
    const url = new URL(API_BASE_URL);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('The finance API must use a local loopback URL.');
    }
}
export class UnknownWriteOutcomeError extends Error {
    constructor(cause: unknown) {
        super('Save outcome unknown. Check saved records before trying again; the server may have saved this request.', { cause });
        this.name = 'UnknownWriteOutcomeError';
    }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    validateLocalApi();
    const isWrite = Boolean(options.method && options.method !== 'GET');
    let response: Response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        });
    }
    catch (error) {
        if (isWrite)
            throw new UnknownWriteOutcomeError(error);
        if (error instanceof DOMException && error.name === 'AbortError')
            throw error;
        throw new Error('Cannot reach the finance API. Check that the backend is running and retry.', { cause: error });
    }
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.detail;
        throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail)
            ? detail.map((item: {
                msg: string;
            }) => item.msg).join('; ')
            : `Request failed (${response.status}). Please retry.`);
    }
    if (response.status === 204)
        return undefined as T;
    try {
        return await response.json() as T;
    }
    catch (error) {
        if (isWrite)
            throw new UnknownWriteOutcomeError(error);
        throw new Error('The API returned an unreadable response. Please retry.', { cause: error });
    }
}
export interface Page<T> {
    items: T[];
    total: number;
    limit: number;
    offset: number;
}
export interface TransactionRecord {
    id: string;
    title: string;
    amount_usd: string;
    type: 'income' | 'expense';
    category: string;
    transaction_date: string;
}
export interface SubscriptionRecord {
    id: string;
    service_name: string;
    amount_usd: string;
    next_payment_date: string;
    icon: string;
    status: 'active' | 'paused';
}
export interface BudgetRecord {
    monthly_income_usd: string;
    needs_spent_usd: string;
    wants_spent_usd: string;
    savings_usd: string;
}
export interface DashboardRecord {
    income_usd: string;
    expenses_usd: string;
    balance_usd: string;
    transaction_count: number;
    expense_by_category: {
        category: string;
        amount_usd: string;
    }[];
}
export interface SubscriptionSummary {
    active_count: number;
    paused_count: number;
    monthly_cost_usd: string;
}

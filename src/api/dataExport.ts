import { API_BASE_URL } from './client';
import { authenticatedFetch, getSessionEpoch, SessionChangedError } from './authSession';
import type { BudgetRecord, SubscriptionRecord, TransactionRecord } from './client';
import type { Currency } from '../state/financeStore';

export interface AccountExport {
    format: 'finance-dashboard';
    schema_version: 1;
    exported_at: string;
    base_currency: 'USD';
    data: {
        transactions: Omit<TransactionRecord, 'id'>[];
        subscriptions: Omit<SubscriptionRecord, 'id'>[];
        budget: BudgetRecord | null;
        preferences: { display_currency: Currency } | null;
    };
}
const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

function assertActive(epoch: number, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (getSessionEpoch() !== epoch) throw new SessionChangedError();
}
function validateEnvelope(value: unknown): AccountExport {
    if (!value || typeof value !== 'object') throw new Error('The server returned an invalid export.');
    const bundle = value as AccountExport;
    if (bundle.format !== 'finance-dashboard' || bundle.schema_version !== 1 || bundle.base_currency !== 'USD'
        || typeof bundle.exported_at !== 'string' || !bundle.data
        || !Array.isArray(bundle.data.transactions) || !Array.isArray(bundle.data.subscriptions)
        || !('budget' in bundle.data) || !('preferences' in bundle.data)) {
        throw new Error('The server returned an unsupported export format.');
    }
    if (bundle.data.transactions.length > 10000 || bundle.data.subscriptions.length > 1000) {
        throw new Error('The export exceeds the supported record limits.');
    }
    return bundle;
}

export async function fetchAccountExport(signal?: AbortSignal): Promise<{ blob: Blob; bundle: AccountExport }> {
    const epoch = getSessionEpoch();
    assertActive(epoch, signal);
    const url = new URL(`${API_BASE_URL}/data/export`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('The finance API must use a local loopback URL.');
    }
    const response = await authenticatedFetch(url.toString(), { method: 'GET', signal, cache: 'no-store' });
    assertActive(epoch, signal);
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        assertActive(epoch, signal);
        throw new Error(typeof payload?.detail === 'string' ? payload.detail : `Export failed (${response.status}). Please retry.`);
    }
    const bytes = await response.arrayBuffer();
    assertActive(epoch, signal);
    if (bytes.byteLength > MAX_EXPORT_BYTES) throw new Error('The export exceeds the 5 MiB download limit.');
    const bundle = validateEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    assertActive(epoch, signal);
    // Preserve the backend's exact JSON bytes, including decimal strings and null singletons.
    return { blob: new Blob([bytes], { type: 'application/json' }), bundle };
}

export async function downloadAccountExport(signal?: AbortSignal): Promise<void> {
    const epoch = getSessionEpoch();
    const { blob } = await fetchAccountExport(signal);
    assertActive(epoch, signal);
    let objectUrl: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    let clicked = false;
    try {
        objectUrl = URL.createObjectURL(blob);
        anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `finance-dashboard-v1-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        assertActive(epoch, signal);
        anchor.click();
        clicked = true;
    } finally {
        anchor?.remove();
        if (objectUrl) {
            const url = objectUrl;
            // Keep a successful download URL available while the browser consumes it.
            if (clicked) setTimeout(() => URL.revokeObjectURL(url), 60_000);
            else URL.revokeObjectURL(url);
        }
    }
}

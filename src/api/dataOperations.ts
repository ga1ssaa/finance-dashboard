import { API_BASE_URL } from './client';
import { validateApiBaseUrl } from './apiConfig';
import { authenticatedFetch, getAuthSnapshot, getSessionEpoch, SessionChangedError } from './authSession';
import { readImportDocument } from './importPreview';
import type { ResourceCounts } from './importPreview';

export type DataOperationKind = 'import_replace' | 'reset';
export interface PendingDataOperation {
    key: string;
    kind: DataOperationKind;
    userId: string;
    documentSha256: string | null;
    status: 'pending' | 'unknown';
}
export interface DataOperationState {
    operation: PendingDataOperation | null;
    revision: number;
    notice: { code: string; message: string } | null;
}
export interface ResetPreview {
    validation_status: 'valid';
    current: { counts: ResourceCounts };
    replacement_impact: { would_remove: ResourceCounts; would_create: ResourceCounts };
    warnings: { code: string; message: string }[];
    preview_token: string;
    expires_at: string;
}
export interface DataOperationInput {
    kind: DataOperationKind;
    key: string;
    previewToken: string;
    expiresAt: string;
    password: string;
    confirmation: string;
    file?: File;
    preDispatchSignal?: AbortSignal;
    documentSha256?: string | null;
}
export class DataOperationError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = 'DataOperationError';
        this.code = code;
    }
}
// Only nonsecret operation metadata survives a view change. Nothing is persisted to browser storage.
const states = new Map<string, DataOperationState>();
const emptyState: DataOperationState = { operation: null, revision: 0, notice: null };
const listeners = new Set<() => void>();
export function getDataOperationState(userId: string): DataOperationState {
    return states.get(userId) || emptyState;
}
export function subscribeDataOperations(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function updateState(userId: string, state: DataOperationState): void {
    states.set(userId, state);
    for (const listener of listeners) listener();
}
export function dismissDataOperationNotice(userId: string): void {
    const state = getDataOperationState(userId);
    updateState(userId, { ...state, notice: null });
}
function currentUserId(): string {
    const user = getAuthSnapshot().user;
    if (!user) throw new DataOperationError('SESSION_REQUIRED', 'Sign in again before managing account data.');
    return user.id;
}
function assertSession(userId: string, epoch: number): void {
    if (getSessionEpoch() !== epoch || getAuthSnapshot().user?.id !== userId) throw new SessionChangedError();
}
function endpoint(path: string): string {
    const url = new URL(`${API_BASE_URL}/data/${path}`);
    try { validateApiBaseUrl(API_BASE_URL); }
    catch { throw new DataOperationError('API_UNAVAILABLE', 'The finance API origin is not approved.'); }
    return url.toString();
}
function countsValid(value: unknown): value is ResourceCounts {
    if (!value || typeof value !== 'object') return false;
    const counts = value as ResourceCounts;
    return Number.isSafeInteger(counts.transactions) && counts.transactions >= 0
        && Number.isSafeInteger(counts.subscriptions) && counts.subscriptions >= 0
        && [0, 1].includes(counts.budget_profiles) && [0, 1].includes(counts.preferences);
}
function codeMessage(code: string): string {
    if (code === 'DATA_OPERATIONS_UNAVAILABLE') return 'Account data operations are unavailable. No operation was applied.';
    if (code === 'CONFIRMATION_FAILED') return 'Password confirmation failed. Request a new preview and try again.';
    if (['PREVIEW_EXPIRED', 'STATE_CHANGED', 'PREVIEW_USED', 'PREVIEW_INVALID'].includes(code)) {
        return 'This preview is no longer valid. Request a new preview before trying again.';
    }
    if (code === 'IDEMPOTENCY_CONFLICT') return 'The operation key conflicts with another request. Request a new preview.';
    return 'The operation was not applied. Request a new preview and try again.';
}
const publicErrorCodes = new Set([
    'CONFIRMATION_FAILED', 'PREVIEW_INVALID', 'PREVIEW_EXPIRED', 'STATE_CHANGED', 'PREVIEW_USED',
    'IDEMPOTENCY_CONFLICT', 'DATA_OPERATIONS_UNAVAILABLE', 'OPERATION_OUTCOME_UNKNOWN',
    'VALIDATION_FAILED', 'REQUEST_REJECTED', 'RATE_LIMITED', 'CONTENT_TYPE_UNSUPPORTED', 'REQUEST_TOO_LARGE',
]);
async function errorCode(response: Response): Promise<string> {
    const body = await response.json().catch(() => null);
    return typeof body?.code === 'string' && publicErrorCodes.has(body.code) ? body.code : 'REQUEST_REJECTED';
}
export async function fetchResetPreview(signal?: AbortSignal): Promise<ResetPreview> {
    const userId = currentUserId();
    const epoch = getSessionEpoch();
    signal?.throwIfAborted();
    let response: Response;
    try {
        response = await authenticatedFetch(endpoint('reset/preview'), {
            method: 'POST', signal, cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, body: '{}',
        });
    } catch {
        signal?.throwIfAborted();
        assertSession(userId, epoch);
        throw new DataOperationError('PREVIEW_UNAVAILABLE', 'Unable to preview a reset. No account data was changed.');
    }
    signal?.throwIfAborted();
    assertSession(userId, epoch);
    if (!response.ok) {
        const code = await errorCode(response);
        assertSession(userId, epoch);
        throw new DataOperationError(code, codeMessage(code));
    }
    const value = await response.json().catch(() => null) as ResetPreview | null;
    signal?.throwIfAborted();
    assertSession(userId, epoch);
    if (!value || value.validation_status !== 'valid' || !countsValid(value.current?.counts)
        || !countsValid(value.replacement_impact?.would_remove) || !countsValid(value.replacement_impact?.would_create)
        || !Array.isArray(value.warnings) || !value.warnings.every(item => typeof item?.message === 'string')
        || typeof value.preview_token !== 'string' || !value.preview_token || !Number.isFinite(Date.parse(value.expires_at))) {
        throw new DataOperationError('INVALID_PREVIEW', 'The server returned an invalid reset preview.');
    }
    return value;
}
function markUnknown(operation: PendingDataOperation): void {
    const state = getDataOperationState(operation.userId);
    if (state.operation?.key !== operation.key) return;
    updateState(operation.userId, {
        ...state, operation: { ...state.operation, status: 'unknown' },
        notice: { code: 'OUTCOME_UNKNOWN', message: 'The operation may still complete. Check its status; do not start a different operation.' },
    });
}
function acceptReceipt(operation: PendingDataOperation, value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const receipt = value as Record<string, unknown>;
    if (receipt.idempotency_key !== operation.key || receipt.operation !== operation.kind || receipt.status !== 'completed'
        || receipt.document_sha256 !== operation.documentSha256 || typeof receipt.completed_at !== 'string'
        || !countsValid(receipt.removed) || !countsValid(receipt.created)) return false;
    const state = getDataOperationState(operation.userId);
    if (state.operation?.key === operation.key) {
        updateState(operation.userId, {
            operation: null, revision: state.revision + 1,
            notice: { code: 'OPERATION_COMPLETED', message: 'Account data operation completed. Refreshing financial data.' },
        });
    }
    return true;
}
function isDefinitiveRejection(status: number, code: string): boolean {
    return [403, 409, 413, 415, 422, 429].includes(status)
        || (status === 503 && code === 'DATA_OPERATIONS_UNAVAILABLE');
}

export async function dispatchDataOperation(input: DataOperationInput): Promise<'completed' | 'rejected' | 'unknown'> {
    const userId = currentUserId();
    const epoch = getSessionEpoch();
    input.preDispatchSignal?.throwIfAborted();
    const state = getDataOperationState(userId);
    const existing = state.operation;
    const wasUnknown = existing?.status === 'unknown';
    if (existing && (!wasUnknown || existing.key !== input.key || existing.kind !== input.kind)) {
        throw new DataOperationError('OPERATION_PENDING', 'Resolve the existing operation before starting another.');
    }
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.key)) {
        throw new DataOperationError('INVALID_KEY', 'The operation key is invalid.');
    }
    if (!input.previewToken || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) {
        throw new DataOperationError('PREVIEW_EXPIRED', 'This preview expired. Request a new preview.');
    }
    const required = input.kind === 'reset' ? 'RESET MY FINANCIAL DATA' : 'REPLACE MY FINANCIAL DATA';
    if (!input.password || input.confirmation !== required) {
        throw new DataOperationError('CONFIRMATION_REQUIRED', 'Enter your password and the exact confirmation phrase.');
    }
    let document: string | undefined;
    let digest: string | null = null;
    if (input.kind === 'import_replace') {
        if (!input.file) throw new DataOperationError('FILE_REQUIRED', 'Select the original JSON backup.');
        document = await readImportDocument(input.file, input.preDispatchSignal);
        assertSession(userId, epoch);
        input.preDispatchSignal?.throwIfAborted();
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document));
        assertSession(userId, epoch);
        digest = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== input.documentSha256 || (existing && digest !== existing.documentSha256)) {
            throw new DataOperationError('FILE_CHANGED', 'Choose the same original file and request a fresh preview.');
        }
    }
    input.preDispatchSignal?.throwIfAborted();
    if (Date.parse(input.expiresAt) <= Date.now()) throw new DataOperationError('PREVIEW_EXPIRED', 'This preview expired. Request a new preview.');
    assertSession(userId, epoch);
    // Recheck after file I/O so two clicks cannot reserve different keys concurrently.
    const latest = getDataOperationState(userId).operation;
    if (latest !== existing) throw new DataOperationError('OPERATION_PENDING', 'Resolve the existing operation before starting another.');
    const operation: PendingDataOperation = { key: input.key, kind: input.kind, userId, documentSha256: digest, status: 'pending' };
    const url = endpoint(input.kind === 'reset' ? 'reset' : 'import');
    const body = JSON.stringify(input.kind === 'reset'
        ? { preview_token: input.previewToken, password: input.password, confirmation: input.confirmation }
        : { mode: 'replace', source_format: 'v1', document, preview_token: input.previewToken, password: input.password, confirmation: input.confirmation });
    if (new TextEncoder().encode(body).byteLength > 10 * 1024 * 1024) {
        throw new DataOperationError('REQUEST_TOO_LARGE', 'The encoded operation exceeds the 10 MiB limit. No request was sent.');
    }
    updateState(userId, { ...getDataOperationState(userId), operation, notice: null });
    try {
        // The command owns its lifecycle: unmounting a dialog must never cancel an already dispatched write.
        const response = await authenticatedFetch(url, {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1', 'Idempotency-Key': input.key }, body,
        });
        assertSession(userId, epoch);
        if (response.status === 200) {
            const receipt: unknown = await response.json();
            assertSession(userId, epoch);
            if (acceptReceipt(operation, receipt)) return 'completed';
        } else {
            const code = await errorCode(response);
            assertSession(userId, epoch);
            const current = getDataOperationState(userId);
            if (!wasUnknown && current.operation === operation && isDefinitiveRejection(response.status, code)) {
                if (current.operation?.key === input.key) {
                    updateState(userId, { ...current, operation: null, notice: { code, message: codeMessage(code) } });
                }
                return 'rejected';
            }
        }
    } catch {
        // Network errors, unreadable responses, and account changes provide no proof of rollback.
    }
    markUnknown(operation);
    return 'unknown';
}

export async function checkDataOperationStatus(): Promise<'completed' | 'unknown'> {
    const userId = currentUserId();
    const epoch = getSessionEpoch();
    const operation = getDataOperationState(userId).operation;
    if (!operation) throw new DataOperationError('NO_OPERATION', 'There is no unresolved operation in this tab.');
    try {
        const response = await authenticatedFetch(endpoint(`operations/${encodeURIComponent(operation.key)}`), { method: 'GET', cache: 'no-store' });
        assertSession(userId, epoch);
        if (response.status === 200) {
            const receipt: unknown = await response.json();
            assertSession(userId, epoch);
            if (acceptReceipt(operation, receipt)) return 'completed';
        }
    } catch {
        // A missing receipt, including HTTP 404, never proves that the original command cannot finish.
    }
    markUnknown(operation);
    return 'unknown';
}

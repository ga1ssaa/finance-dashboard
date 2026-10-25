import { API_BASE_URL } from './client';
import { authenticatedFetch, getSessionEpoch, SessionChangedError } from './authSession';

export interface ResourceCounts {
    transactions: number;
    subscriptions: number;
    budget_profiles: 0 | 1;
    preferences: 0 | 1;
}
export interface ImportPreview {
    validation_status: 'valid';
    document_sha256: string;
    preview_token: string;
    expires_at: string;
    source: {
        format: 'finance-dashboard';
        schema_version: 1;
        exported_at: string;
        base_currency: 'USD';
        counts: ResourceCounts;
    };
    current: { counts: ResourceCounts };
    replacement_impact: { would_remove: ResourceCounts; would_create: ResourceCounts };
    warnings: { code: string; message: string }[];
}
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

function assertActive(epoch: number, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (epoch !== getSessionEpoch()) throw new SessionChangedError();
}
function isCounts(value: unknown): value is ResourceCounts {
    if (!value || typeof value !== 'object') return false;
    const counts = value as ResourceCounts;
    return Number.isSafeInteger(counts.transactions) && counts.transactions >= 0
        && Number.isSafeInteger(counts.subscriptions) && counts.subscriptions >= 0
        && [0, 1].includes(counts.budget_profiles) && [0, 1].includes(counts.preferences);
}
function readPreview(value: unknown): ImportPreview {
    const preview = value as ImportPreview | null;
    if (!preview || preview.validation_status !== 'valid'
        || typeof preview.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(preview.document_sha256)
        || typeof preview.preview_token !== 'string' || !preview.preview_token
        || typeof preview.expires_at !== 'string' || !Number.isFinite(Date.parse(preview.expires_at))
        || preview.source?.format !== 'finance-dashboard' || preview.source.schema_version !== 1
        || preview.source.base_currency !== 'USD' || typeof preview.source.exported_at !== 'string'
        || !isCounts(preview.source.counts) || !isCounts(preview.current?.counts)
        || !isCounts(preview.replacement_impact?.would_remove) || !isCounts(preview.replacement_impact?.would_create)
        || !Array.isArray(preview.warnings)
        || !preview.warnings.every(item => item && typeof item.code === 'string' && typeof item.message === 'string')) {
        throw new Error('The server returned an invalid import preview. No account data was changed.');
    }
    return preview;
}

export async function readImportDocument(file: File, signal?: AbortSignal): Promise<string> {
    const epoch = getSessionEpoch();
    assertActive(epoch, signal);
    if (file.size > MAX_FILE_BYTES) throw new Error('Choose a JSON backup no larger than 5 MiB.');
    let bytes: ArrayBuffer;
    try {
        bytes = await file.arrayBuffer();
    } catch (error) {
        assertActive(epoch, signal);
        throw new Error('The selected file could not be read. Choose a JSON backup and try again.', { cause: error });
    }
    assertActive(epoch, signal);
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Choose a JSON backup no larger than 5 MiB.');
    let document: string;
    try {
        // Preserve a BOM for server validation; reject malformed UTF-8 instead of replacing bytes.
        document = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
        throw new Error('The selected file must contain valid UTF-8 JSON.', { cause: error });
    }
    if (new TextEncoder().encode(document).byteLength > MAX_FILE_BYTES) {
        throw new Error('Choose a JSON backup no larger than 5 MiB.');
    }
    assertActive(epoch, signal);
    return document;
}

export async function previewImportFile(file: File, signal?: AbortSignal): Promise<ImportPreview> {
    const epoch = getSessionEpoch();
    const document = await readImportDocument(file, signal);
    assertActive(epoch, signal);
    // Only serialize the outer request. The document's decimal lexemes and duplicate keys stay intact.
    const body = JSON.stringify({ mode: 'replace', source_format: 'v1', document });
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
        throw new Error('The encoded preview request exceeds the 10 MiB limit.');
    }
    assertActive(epoch, signal);
    const url = new URL(`${API_BASE_URL}/data/import/preview`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('The finance API must use a local loopback URL.');
    }
    let response: Response;
    try {
        response = await authenticatedFetch(url.toString(), {
            method: 'POST', signal, cache: 'no-store',
            headers: { 'Content-Type': 'application/json' }, body,
        });
    } catch (error) {
        assertActive(epoch, signal);
        throw new Error('Unable to request an import preview. Please retry. No account data was changed.', { cause: error });
    }
    assertActive(epoch, signal);
    if (!response.ok) {
        const message = response.status === 413 ? 'The file exceeds the supported import preview limits.'
            : response.status === 422 ? 'This file is not a valid version 1 USD backup.'
            : response.status === 503 ? 'The preview service is temporarily unavailable. Please retry.'
            : 'Unable to preview this backup. Please retry.';
        // Do not echo validation input or file contents from error responses.
        throw new Error(`${message} No account data was changed.`);
    }
    let value: unknown;
    try {
        value = await response.json();
    } catch (error) {
        assertActive(epoch, signal);
        throw new Error('The server returned an unreadable import preview. No account data was changed.', { cause: error });
    }
    assertActive(epoch, signal);
    return readPreview(value);
}

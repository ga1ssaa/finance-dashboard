export interface AuthUser {
    id: string;
    email: string;
}
interface TokenResponse {
    access_token: string;
    token_type: 'bearer';
    expires_in: number;
    user: AuthUser;
}
export interface AuthSnapshot {
    user: AuthUser | null;
    status: 'loading' | 'authenticated' | 'anonymous' | 'error' | 'signing-out' | 'logout-error';
    error: string;
    epoch: number;
}
export class SessionChangedError extends Error {
    constructor() {
        super('The account session changed. This request was discarded.');
        this.name = 'SessionChangedError';
    }
}
export class SessionExpiredError extends Error {
    constructor() {
        super('Your session has expired. Sign in again to continue.');
        this.name = 'SessionExpiredError';
    }
}
let apiBaseUrl = 'http://127.0.0.1:8000/api/v1';
let accessToken: string | null = null;
let snapshot: AuthSnapshot = { user: null, status: 'loading', error: '', epoch: 0 };
let refreshPromise: Promise<AuthUser | null> | null = null;
const listeners = new Set<() => void>();
let cookieOperation: Promise<void> = Promise.resolve();
function serializeCookieOperation<T>(action: () => Promise<T>): Promise<T> {
    const result = cookieOperation.then(action, action);
    cookieOperation = result.then(() => {}, () => {});
    return result;
}

export function configureAuthApi(baseUrl: string): void {
    apiBaseUrl = baseUrl;
}
export function getAuthSnapshot(): AuthSnapshot {
    return snapshot;
}
export function getSessionEpoch(): number {
    return snapshot.epoch;
}
export function subscribeAuth(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function publish(next: AuthSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
}
function clearSession(status: AuthSnapshot['status'], error = ''): number {
    accessToken = null;
    refreshPromise = null;
    const epoch = snapshot.epoch + 1;
    publish({ user: null, status, error, epoch });
    return epoch;
}
function assertEpoch(epoch: number): void {
    if (epoch !== snapshot.epoch) throw new SessionChangedError();
}
function authRequest<T>(path: string, epoch: number, body?: object): Promise<T> {
    return serializeCookieOperation(async () => {
        assertEpoch(epoch);
        return sendAuthRequest<T>(path, body);
    });
}
async function sendAuthRequest<T>(path: string, body?: object): Promise<T> {
    const url = new URL(apiBaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('The finance API must use a local loopback URL.');
    }
    let response: Response;
    try {
        response = await fetch(`${apiBaseUrl}/auth/${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-CSRF-Protection': '1' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
    } catch (error) {
        throw new Error('Cannot reach the sign-in service. Check the backend connection and retry.', { cause: error });
    }
    if (response.status === 401 && path === 'refresh') throw new SessionExpiredError();
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.detail;
        throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail)
            ? detail.map((item: { msg: string }) => item.msg).join('; ')
            : `Sign-in request failed (${response.status}).`);
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
function adoptSession(value: TokenResponse, epoch: number): AuthUser {
    assertEpoch(epoch);
    const changedUser = snapshot.user?.id !== value.user.id;
    accessToken = value.access_token;
    publish({ user: value.user, status: 'authenticated', error: '', epoch: changedUser ? epoch + 1 : epoch });
    return value.user;
}
export function restoreSession(): Promise<AuthUser | null> {
    if (refreshPromise) return refreshPromise;
    const epoch = snapshot.epoch;
    if (!snapshot.user) {
        publish({ ...snapshot, status: 'loading', error: '' });
    }
    const operation = authRequest<TokenResponse>('refresh', epoch)
        .then(value => adoptSession(value, epoch))
        .catch(error => {
            assertEpoch(epoch);
            if (error instanceof SessionExpiredError) {
                clearSession('anonymous', snapshot.user ? error.message : '');
                return null;
            }
            clearSession('error', error instanceof Error ? error.message : 'Unable to restore your session.');
            throw error;
        })
        .finally(() => {
            if (refreshPromise === operation) refreshPromise = null;
        });
    refreshPromise = operation;
    return operation;
}
async function authenticate(path: 'login' | 'register', email: string, password: string): Promise<AuthUser> {
    if (snapshot.status === 'signing-out' || snapshot.status === 'logout-error') {
        throw new Error('Finish signing out before signing in to another account.');
    }
    const epoch = clearSession('anonymous');
    try {
        const value = await authRequest<TokenResponse>(path, epoch, { email, password });
        return adoptSession(value, epoch);
    } catch (error) {
        assertEpoch(epoch);
        throw error;
    }
}
export function login(email: string, password: string): Promise<AuthUser> {
    return authenticate('login', email, password);
}
export function register(email: string, password: string): Promise<AuthUser> {
    return authenticate('register', email, password);
}
export async function logout(): Promise<void> {
    const epoch = clearSession('signing-out');
    try {
        await authRequest<void>('logout', epoch);
        assertEpoch(epoch);
        publish({ user: null, status: 'anonymous', error: '', epoch });
    } catch (error) {
        assertEpoch(epoch);
        publish({ user: null, status: 'logout-error', error: 'Your local session is cleared, but server sign-out could not be confirmed. Retry signing out.', epoch });
        throw error;
    }
}
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const epoch = snapshot.epoch;
    if (!accessToken || !snapshot.user) throw new SessionExpiredError();
    let sentToken: string | null = accessToken;
    const send = () => {
        assertEpoch(epoch);
        sentToken = accessToken;
        const headers = new Headers(options.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        return fetch(url, { ...options, credentials: 'omit', headers }).catch(error => {
            assertEpoch(epoch);
            throw error;
        });
    };
    let response = await send();
    assertEpoch(epoch);
    if (response.status === 401) {
        if (sentToken === accessToken) {
            const user = await restoreSession();
            assertEpoch(epoch);
            if (!user) throw new SessionExpiredError();
        }
        // A received 401 rejects authentication before the financial mutation runs.
        response = await send();
        assertEpoch(epoch);
        if (response.status === 401) {
            clearSession('anonymous', 'Your session has expired. Sign in again to continue.');
            throw new SessionExpiredError();
        }
    }
    return response;
}

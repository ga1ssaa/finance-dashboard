/** One endpoint policy for auth, CRUD, export, preview and destructive operations. */
export function validateApiBaseUrl(
    value: string,
    appOrigin = import.meta.env?.VITE_APP_ORIGIN || '',
    browserOrigin = typeof window === 'undefined' ? '' : window.location?.origin || '',
): URL {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'];
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/v1' || value !== url.origin + '/api/v1') {
        throw new Error('Configure an API base URL ending in /api/v1 without credentials, query or fragment.');
    }
    if (local.includes(url.hostname) && ['http:', 'https:'].includes(url.protocol)) {
        if (browserOrigin && !local.includes(new URL(browserOrigin).hostname)) {
            throw new Error('A public frontend requires an explicitly configured HTTPS production API.');
        }
        return url;
    }
    const frontend = appOrigin ? new URL(appOrigin) : null;
    const site = frontend?.hostname.split('.').slice(-2).join('.') || '';
    const validHost = (host: string) => host === site || host.endsWith(`.${site}`);
    if (!frontend || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:me|app)$/.test(site)
        || frontend.protocol !== 'https:' || appOrigin !== frontend.origin
        || frontend.username || frontend.password || frontend.port || url.port
        || url.protocol !== 'https:' || !validHost(url.hostname)
        || (browserOrigin && browserOrigin !== frontend.origin)) {
        throw new Error('The finance API requires a local loopback URL or approved same-site HTTPS .me/.app origins.');
    }
    return url;
}

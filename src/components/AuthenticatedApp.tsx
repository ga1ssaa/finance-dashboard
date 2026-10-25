import { Navigate, useLocation } from 'react-router-dom';
import App from '../App';
import { useAuth } from '../state/authStore';
import { FinanceProvider } from '../state/FinanceProvider';
import AuthPage from '../pages/AuthPage';

export default function AuthenticatedApp() {
    const auth = useAuth();
    const location = useLocation();
    if (auth.status === 'loading' || auth.status === 'signing-out') {
        return <main className="min-h-screen bg-canvas flex items-center justify-center"><p role="status" className="text-secondary">{auth.status === 'loading' ? 'Restoring your session…' : 'Signing out…'}</p></main>;
    }
    if (auth.status === 'error' || auth.status === 'logout-error') {
        return (
            <main className="min-h-screen bg-canvas flex items-center justify-center p-6">
                <div className="max-w-md rounded-modal border border-subtle bg-surface p-8 space-y-4">
                    <h1 className="font-sans text-2xl font-bold text-primary">{auth.status === 'logout-error' ? 'Sign-out needs a retry' : 'Unable to restore your session'}</h1>
                    <p role="alert" className="text-secondary">{auth.error}</p>
                    <button onClick={auth.status === 'logout-error' ? () => { void auth.logout().catch(() => {}); } : auth.retry} className="rounded-control bg-accent px-4 py-2 text-accent-ink font-semibold">Retry</button>
                </div>
            </main>
        );
    }
    if (!auth.user) {
        if (location.pathname !== '/login' && location.pathname !== '/register') {
            return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
        }
        return <AuthPage key={location.pathname} registering={location.pathname === '/register'} />;
    }
    if (location.pathname === '/login' || location.pathname === '/register') {
        const from = location.state?.from;
        const destination = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
            && !['/login', '/register'].includes(from.split('?')[0]) ? from : '/';
        return <Navigate to={destination} replace />;
    }
    // A fresh subtree prevents old-account resources, drafts, and modal state surviving a switch.
    return <FinanceProvider key={`${auth.user.id}:${auth.epoch}`}><App /></FinanceProvider>;
}

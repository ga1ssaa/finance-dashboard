import { useLocation, useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import { ArrowRight, Mail, Eye, EyeOff } from 'lucide-react';
import AveroBrand from '../components/AveroBrand';
import { useAuth } from '../state/authStore';
import useTheme from '../hooks/useTheme';

const inputClassName = 'auth-input pr-14';

export default function AuthPage({ registering }: { registering: boolean }) {
    useTheme();
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (pending.current) return;
        if (registering && [...password].length < 8) {
            setError('Password must contain at least 8 characters.');
            return;
        }
        if (registering && password !== confirmation) {
            setError('Passwords do not match.');
            return;
        }
        pending.current = true;
        setSaving(true);
        setError('');
        try {
            await (registering ? auth.register(email.trim(), password) : auth.login(email.trim(), password));
            setPassword('');
            setConfirmation('');
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to sign in. Please retry.');
        } finally {
            pending.current = false;
            setSaving(false);
        }
    };
    return (
        <main className="auth-page">
                <section className="auth-marketing" aria-labelledby="auth-headline">
                    <AveroBrand inverse className="auth-brand" />
                    <div className="auth-editorial">
                        <p className="auth-eyebrow">Your personal finance space</p>
                        <h2 id="auth-headline" className="auth-headline">A clearer view of your financial life.</h2>
                        <p className="auth-description">Track spending, plan your budget, and keep recurring payments in one place.</p>
                        <ul className="auth-features" aria-label="AVERO features">
                            <li><h3>Track spending</h3><p>See income and expenses together.</p></li>
                            <li><h3>Plan budgets</h3><p>Keep your monthly 50/30/20 plan in view.</p></li>
                            <li><h3>Manage subscriptions</h3><p>Stay aware of recurring commitments.</p></li>
                        </ul>
                    </div>
                    <p className="auth-panel-note">Your accounts, budgets, and goals belong to you.</p>
                </section>
                <section className="auth-form-panel" aria-labelledby="auth-form-heading">
                  <div className="auth-form-content">
                    <AveroBrand className="auth-brand auth-mobile-brand" />
                    <h1 id="auth-form-heading" className="auth-form-heading">
                        {registering ? 'Create your account' : 'Welcome back'}
                    </h1>
                    <p className="auth-form-subtitle">
                        {registering ? 'Start with a fresh, private finance dashboard.' : 'Sign in to your finance dashboard.'}
                    </p>
                    {(error || auth.error) && (
                        <div role="alert" className="mb-5 rounded-card border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-300">
                            {error || auth.error}
                        </div>
                    )}
                    <form onSubmit={submit} className="space-y-5">
                        <label className="block text-sm font-medium text-secondary">
                            Email address
                            <div className="relative mt-2">
                                <Mail size={17} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                                <input
                                    aria-label="Email address"
                                    type="email"
                                    autoComplete="username"
                                    required
                                    maxLength={254}
                                    value={email}
                                    onChange={event => setEmail(event.target.value)}
                                    className="auth-input pl-10"
                                />
                            </div>
                        </label>
                        <div>
                            <label htmlFor="auth-password" className="block text-sm font-medium text-secondary">
                                Password
                            </label>
                            <div className="relative mt-2">
                                <input
                                    id="auth-password"
                                    aria-label="Password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete={registering ? 'new-password' : 'current-password'}
                                    required
                                    minLength={registering ? 8 : undefined}
                                    maxLength={128}
                                    value={password}
                                    onChange={event => setPassword(event.target.value)}
                                    className={inputClassName}
                                />
                                <button
                                    type="button"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    aria-pressed={showPassword}
                                    aria-controls="auth-password"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="ui-icon-button absolute right-1 top-1/2 -translate-y-1/2 hover:text-accent"
                                >
                                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                                </button>
                            </div>
                        </div>
                        {registering && (
                            <div>
                                <label htmlFor="auth-confirmation" className="block text-sm font-medium text-secondary">
                                    Confirm password
                                </label>
                                <div className="relative mt-2">
                                    <input
                                        id="auth-confirmation"
                                        aria-label="Confirm password"
                                        type={showConfirmation ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        required
                                        minLength={8}
                                        maxLength={128}
                                        value={confirmation}
                                        onChange={event => setConfirmation(event.target.value)}
                                        className={inputClassName}
                                    />
                                    <button
                                        type="button"
                                        aria-label={showConfirmation ? 'Hide password confirmation' : 'Show password confirmation'}
                                        aria-pressed={showConfirmation}
                                        aria-controls="auth-confirmation"
                                        onClick={() => setShowConfirmation(!showConfirmation)}
                                        className="ui-icon-button absolute right-1 top-1/2 -translate-y-1/2 hover:text-accent"
                                    >
                                        {showConfirmation ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                                    </button>
                                </div>
                                <span className="block mt-2 text-xs text-secondary">
                                    Use 8–128 characters. Spaces in passwords are preserved.
                                </span>
                            </div>
                        )}
                        <button type="submit" disabled={saving} className="auth-submit">
                            {saving ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
                            <ArrowRight size={18} aria-hidden="true" />
                        </button>
                    </form>
                    <p className="auth-switch">
                        {registering ? 'Already have an account?' : 'New to AVERO?'}
                        <button
                            disabled={saving}
                            onClick={() => navigate(registering ? '/login' : '/register', { state: location.state })}
                            className="ml-1 inline-flex min-h-11 items-center rounded-control text-accent font-medium hover:underline"
                        >
                            {registering ? 'Sign in' : 'Create an account'}
                        </button>
                    </p>
                  </div>
                </section>
        </main>
    );
}

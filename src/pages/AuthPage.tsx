import { useLocation, useNavigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, LockKeyhole, Mail, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../state/authStore';

const inputClassName = 'w-full px-4 py-2.5 mt-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-slate-800 dark:text-white';

export default function AuthPage({ registering }: { registering: boolean }) {
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
        <main className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
            <div className="w-full max-w-5xl grid lg:grid-cols-2 overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
                <section className="hidden lg:flex flex-col justify-between bg-blue-600 p-12 text-white">
                    <div className="flex items-center gap-3 font-serif text-2xl font-bold">
                        <ChartNoAxesCombined size={28} />FinanceApp
                    </div>
                    <div className="py-16">
                        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm">
                            <ShieldCheck size={16} />Your personal finance space
                        </span>
                        <h1 className="font-serif text-4xl font-bold leading-tight mt-6">
                            A clearer view of<br />your financial life.
                        </h1>
                        <p className="text-blue-100 mt-5 leading-relaxed">
                            Track spending, plan your budget, and keep recurring payments in one place.
                        </p>
                    </div>
                    <p className="text-sm text-blue-100">Your accounts, budgets, and goals belong to you.</p>
                </section>
                <section className="p-7 sm:p-12">
                    <p className="lg:hidden text-blue-600 font-serif text-xl font-bold mb-8">FinanceApp</p>
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center mb-6">
                        <LockKeyhole size={24} />
                    </div>
                    <h2 className="font-serif text-3xl font-bold text-slate-800 dark:text-white">
                        {registering ? 'Create your account' : 'Welcome back'}
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 mb-7">
                        {registering ? 'Start with a fresh, private finance dashboard.' : 'Sign in to your finance dashboard.'}
                    </p>
                    {(error || auth.error) && (
                        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-300">
                            {error || auth.error}
                        </div>
                    )}
                    <form onSubmit={submit} className="space-y-5">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            Email address
                            <div className="relative mt-2">
                                <Mail size={17} className="absolute left-3 top-3 text-slate-400" />
                                <input
                                    aria-label="Email address"
                                    type="email"
                                    autoComplete="username"
                                    required
                                    maxLength={254}
                                    value={email}
                                    onChange={event => setEmail(event.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-slate-800 dark:text-white"
                                />
                            </div>
                        </label>
                        <div>
                            <label htmlFor="auth-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                Password
                            </label>
                            <div className="relative">
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
                                    className={`${inputClassName} pr-12`}
                                />
                                <button
                                    type="button"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    aria-pressed={showPassword}
                                    aria-controls="auth-password"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 mt-1 p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                >
                                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                                </button>
                            </div>
                        </div>
                        {registering && (
                            <div>
                                <label htmlFor="auth-confirmation" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Confirm password
                                </label>
                                <div className="relative">
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
                                        className={`${inputClassName} pr-12`}
                                    />
                                    <button
                                        type="button"
                                        aria-label={showConfirmation ? 'Hide password confirmation' : 'Show password confirmation'}
                                        aria-pressed={showConfirmation}
                                        aria-controls="auth-confirmation"
                                        onClick={() => setShowConfirmation(!showConfirmation)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 mt-1 p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                    >
                                        {showConfirmation ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                                    </button>
                                </div>
                                <span className="block mt-2 text-xs text-slate-500">
                                    Use 8–128 characters. Spaces in passwords are preserved.
                                </span>
                            </div>
                        )}
                        <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 disabled:opacity-60">
                            {saving ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
                            <ArrowRight size={18} />
                        </button>
                    </form>
                    <p className="mt-7 text-sm text-center text-slate-500 dark:text-slate-400">
                        {registering ? 'Already have an account?' : 'New to FinanceApp?'}
                        <button
                            disabled={saving}
                            onClick={() => navigate(registering ? '/login' : '/register', { state: location.state })}
                            className="text-blue-600 dark:text-blue-400 font-bold ml-1"
                        >
                            {registering ? 'Sign in' : 'Create an account'}
                        </button>
                    </p>
                </section>
            </div>
        </main>
    );
}

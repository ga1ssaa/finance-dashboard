import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { API_BASE_URL } from '../api/client';
import { configureAuthApi, getAuthSnapshot, login, logout, register, restoreSession, subscribeAuth } from '../api/authSession';
import { AuthContext } from './authStore';

export function AuthProvider({ children }: { children: ReactNode }) {
    const snapshot = useSyncExternalStore(subscribeAuth, getAuthSnapshot);
    useEffect(() => {
        configureAuthApi(API_BASE_URL);
        void restoreSession().catch(() => {});
    }, []);
    const retry = () => { void restoreSession().catch(() => {}); };
    return (
        <AuthContext.Provider value={{ ...snapshot, login, register, logout, retry }}>
            {children}
        </AuthContext.Provider>
    );
}

import { createContext, useContext } from 'react';
import type { AuthSnapshot, AuthUser } from '../api/authSession';
export interface AuthState extends AuthSnapshot {
    login: (email: string, password: string) => Promise<AuthUser>;
    register: (email: string, password: string) => Promise<AuthUser>;
    logout: () => Promise<void>;
    retry: () => void;
}
export const AuthContext = createContext<AuthState | null>(null);
export function useAuth(): AuthState {
    const value = useContext(AuthContext);
    if (!value) throw new Error('AuthProvider is required');
    return value;
}

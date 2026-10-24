import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { useFinance } from '../state/financeStore';
export function useResource<T>(path: string) {
    const { revision, refresh } = useFinance();
    const [state, setState] = useState<{
        data: T | null;
        loading: boolean;
        error: string;
        path: string;
        revision: number;
    }>({ data: null, loading: true, error: '', path, revision });
    useEffect(() => {
        const controller = new AbortController();
        request<T>(path, { signal: controller.signal })
            .then(data => {
                if (!controller.signal.aborted) {
                    setState({ data, loading: false, error: '', path, revision });
                }
            })
            .catch(error => {
                if (!controller.signal.aborted) {
                    setState({ data: null, loading: false, error: error.message, path, revision });
                }
            });
        return () => controller.abort();
    }, [path, revision]);
    const current = state.path === path && state.revision === revision;
    return {
        data: current ? state.data : null,
        loading: !current || state.loading,
        error: current ? state.error : '',
        retry: refresh,
    };
}

interface Props { loading?: boolean; error?: string; retry?: () => void }
export default function ResourceStatus({loading,error,retry}:Props) {
    if (loading) return <p role="status" className="p-4 text-slate-500 dark:text-slate-300">Loading financial data…</p>;
    if (!error) return null;
    return <div role="alert" className="p-4 rounded-xl border border-red-200 text-red-600 dark:text-red-300">{error} {retry && <button onClick={retry} className="underline font-bold ml-2">Retry</button>}</div>;
}

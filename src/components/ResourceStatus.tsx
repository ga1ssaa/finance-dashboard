interface Props { loading?: boolean; error?: string; retry?: () => void }
export default function ResourceStatus({loading,error,retry}:Props) {
    if (loading) return <p role="status" className="p-4 text-secondary">Loading financial data…</p>;
    if (!error) return null;
    return <div role="alert" className="ui-status border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-300">{error} {retry && <button onClick={retry} className="underline font-medium ml-2">Retry</button>}</div>;
}

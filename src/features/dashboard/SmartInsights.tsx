import { Link } from 'react-router-dom';
import type { OverviewInsight } from './overviewData';

export default function SmartInsights({ insights }: { insights: OverviewInsight[] }) {
    return (
        <section aria-labelledby="financial-insights-title" className="overview-section">
            <div className="overview-section-heading"><h2 id="financial-insights-title" className="text-lg font-semibold">Financial insights</h2></div>
            {insights.length ? <ul className="grid gap-6 md:grid-cols-3">
                {insights.map(item => <li key={item.id} className="min-w-0 border-l-2 border-subtle pl-4"><h3 className="text-sm font-medium">{item.title}</h3><p className="mt-2 text-sm leading-6 text-secondary [overflow-wrap:anywhere]">{item.message}</p><Link to={item.href} className="overview-text-link mt-2">{item.action}</Link></li>)}
            </ul> : <p className="py-3 text-sm text-secondary">No observations to show yet. Add transactions or set a manual budget; observations use only available records.</p>}
        </section>
    );
}

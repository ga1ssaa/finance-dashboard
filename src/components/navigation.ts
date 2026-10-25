import { LayoutDashboard, ArrowRightLeft, Target, CreditCard, Settings } from 'lucide-react';

export const navigationItems = [
    { path: '/', label: 'Overview', icon: LayoutDashboard },
    { path: '/transactions', label: 'Transactions', icon: ArrowRightLeft },
    { path: '/budget', label: 'Budget and Goals', icon: Target },
    { path: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
    { path: '/settings', label: 'Settings', icon: Settings },
] as const;

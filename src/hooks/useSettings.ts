import { useState, useEffect, useCallback } from "react";
import type { Transaction, Subscription } from "../types/finance";

export type Currency = "USD" | "KZT" | "EUR" | "RUB";

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
    USD: "$",
    KZT: "₸",
    EUR: "€",
    RUB: "₽",
};

const KEYS = {
    TRANSACTIONS: "finance_app_transactions",
    SUBSCRIPTIONS: "finance_app_subscriptions",
    INCOME: "finance_app_monthly_income",
    EXPENSE: "finance_app_monthly_expense",
    CURRENCY: "finance_app_currency",
    RATES: "finance_app_exchange_rates",
    RATES_UPDATED: "finance_app_rates_updated_at",
};

const DEFAULT_RATES: Record<Currency, number> = {
    USD: 1,
    KZT: 475,
    EUR: 0.92,
    RUB: 88,
};

export function useSettings() {
    const [currency, setCurrency] = useState<Currency>(() => {
        return (localStorage.getItem(KEYS.CURRENCY) as Currency) || "USD";
    });
    
    const [rates, setRates] = useState<Record<Currency, number>>(() => {
        const savedRates = localStorage.getItem(KEYS.RATES);
        return savedRates ? JSON.parse(savedRates) : DEFAULT_RATES;
    });
    
    const [isLoadingRates, setIsLoadingRates] = useState(false);

    const toBaseCurrency = useCallback(
        (amountInCurrentCurrency: number): number => {
            const rate = rates[currency] || 1;
            return amountInCurrentCurrency / rate;
        }, [currency, rates]);
    
    useEffect(() => {
        const fetchRates = async () => {
        const lastUpdated = localStorage.getItem(KEYS.RATES_UPDATED);
        const twelveHours = 12 * 60 * 60 * 1000;

        if(lastUpdated && Date.now() - Number(lastUpdated) < twelveHours && localStorage.getItem(KEYS.RATES)) {
            return;
        }

        setIsLoadingRates(true);
        try{
            const response = await fetch("https://open.er-api.com/v6/latest/USD");
            const data = await response.json();

        if(data && data.rates){
            const newRates: Record<Currency, number> = {
                USD: 1,
                KZT: data.rates.KZT || DEFAULT_RATES.KZT,
                EUR: data.rates.EUR || DEFAULT_RATES.EUR,
                RUB: data.rates.RUB || DEFAULT_RATES.RUB,
            };
            
            setRates(newRates);
            localStorage.setItem(KEYS.RATES, JSON.stringify(newRates));
            localStorage.setItem(KEYS.RATES_UPDATED, Date.now().toString());
        }
    
    } 
        catch(error){
            console.error("Failed to fetch exchange rates, using fallback rates:", error);
        }
        finally {
            setIsLoadingRates(false);
        }
    };
  
        fetchRates();

    }, []);
  
    useEffect(() => {
        localStorage.setItem(KEYS.CURRENCY, currency);
    }, [currency]);

  
    const convertAmount = useCallback(
        (amountInUSD: number, targetCurrency: Currency = currency): number => {
            const rate = rates[targetCurrency] || 1;
            return amountInUSD * rate;
        }, [currency, rates]
    );

    const formatAmount = useCallback(
        (amountInUSD: number, targetCurrency: Currency = currency): string => {
            const converted = convertAmount(amountInUSD, targetCurrency);
            const symbol = CURRENCY_SYMBOLS[targetCurrency];
            
            const decimals = targetCurrency === "KZT" || targetCurrency === "RUB" ? 0 : 2;

            return `${symbol} ${converted.toLocaleString("ru-RU", {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            })}`;
            },
            [convertAmount, currency]
        );

    const resetAllData = () => {
        localStorage.clear();
        window.location.reload();
    };

    const exportData = () => {
        const rawTx = localStorage.getItem(KEYS.TRANSACTIONS);
        const rawSub = localStorage.getItem(KEYS.SUBSCRIPTIONS);
        const rawIncome = localStorage.getItem(KEYS.INCOME);
        const rawSpent = localStorage.getItem(KEYS.EXPENSE);

        const txList: Transaction[] = rawTx ? JSON.parse(rawTx) : [];
        const subList: Subscription[] = rawSub ? JSON.parse(rawSub) : [];
        const incomeVal: number = rawIncome ? JSON.parse(rawIncome) : 5000;
        const spentVal = rawSpent ? JSON.parse(rawSpent) : null;

        const currentRate = rates[currency] || 1;
        const toCurrentCurrency = (val: number) => Number((val * currentRate).toFixed(2));

        const data = {
                transactions: txList.map((tx) => ({
                    ...tx,
                    amount: toCurrentCurrency(tx.amount),
                })),
                subscriptions: subList.map((sub) => ({
                    ...sub,
                    amount: toCurrentCurrency(sub.amount),
                })),
                monthlyIncome: toCurrentCurrency(incomeVal),
                spentData: spentVal
                    ? {
                          needs: toCurrentCurrency(spentVal.needs || 0),
                          wants: toCurrentCurrency(spentVal.wants || 0),
                          savings: toCurrentCurrency(spentVal.savings || 0),
                      }
                    : null,
                currency,
                rates,
                exportedAt: new Date().toISOString(),
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `finance_backup_${new Date().toISOString().split("T")[0]}.json`;
            link.click();
            URL.revokeObjectURL(url);
        };

    const importData = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const parsed = JSON.parse(content);

                const fileCurrency = (parsed.currency as Currency) || "USD";
                const importRate = parsed.rates?.[fileCurrency] || rates[fileCurrency] || 1;
                const toUSD = (val: number) => Number((val / importRate).toFixed(2));

                if (parsed.transactions && Array.isArray(parsed.transactions)) {
                    const convertedTx = (parsed.transactions as Transaction[]).map((tx) => ({
                        ...tx,
                        amount: toUSD(tx.amount),
                    }));
                    localStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(convertedTx));
                }

                if (parsed.subscriptions && Array.isArray(parsed.subscriptions)) {
                    const convertedSub = (parsed.subscriptions as Subscription[]).map((sub) => ({
                        ...sub,
                        amount: toUSD(sub.amount),
                    }));
                    localStorage.setItem(KEYS.SUBSCRIPTIONS, JSON.stringify(convertedSub));
                }

                if (parsed.monthlyIncome !== undefined) {
                    localStorage.setItem(KEYS.INCOME, JSON.stringify(toUSD(parsed.monthlyIncome)));
                }

                if (parsed.spentData) {
                    const convertedSpent = {
                        needs: toUSD(parsed.spentData.needs || 0),
                        wants: toUSD(parsed.spentData.wants || 0),
                        savings: toUSD(parsed.spentData.savings || 0),
                    };
                    localStorage.setItem(KEYS.EXPENSE, JSON.stringify(convertedSpent));
                }

                if (parsed.currency) {
                    localStorage.setItem(KEYS.CURRENCY, parsed.currency);
                }

                alert("Data imported successfully!");
                window.location.reload();
            } catch (error) {
                console.error("Invalid backup file format:", error);
                alert("Failed to import data. Invalid file format.");
            }
        };
        reader.readAsText(file);
    };

    return {
        currency,
        setCurrency,
        rates,
        isLoadingRates,
        convertAmount,
        toBaseCurrency,
        formatAmount,
        resetAllData,
        exportData,
        importData,
    };
}
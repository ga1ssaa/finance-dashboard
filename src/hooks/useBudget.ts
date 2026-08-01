// 50/30/20 Rule (50% for necessary expenses, 30% for entertainment, 20% for savings)
import  { useEffect, useState } from "react";

const STORAGE_KEY_INCOME = "finance_app_monthly_income";
const STORAGE_KEY_EXPENSE = "finance_app_monthly_expense";

const DEFAULT_SPENT = {
    needs: 2100,
    wants: 1600,
    savings: 500,
};

export function useBudget(){

    const [monthlyIncome, setMonthlyIncome] = useState<number>(() => {
        const savedIncome = localStorage.getItem("monthlyIncome");
        // using new changed/saved income or by default 5000
        return savedIncome ? parseFloat(savedIncome) : 5000;
    });

    // 50% = 2500 , 30% = 1500 , 20% = 1000
    // Data of expenses from localStorage
    const [spentData, setSpentData] = useState(() => {
        const savedSpent = localStorage.getItem(STORAGE_KEY_EXPENSE);
        if(savedSpent){
            try{
                return JSON.parse(savedSpent);
            }
            catch(error){
                console.error("Failed to parse spent data", error);
            }
        }
        return DEFAULT_SPENT;
    })

    // Using for saving new income(if it was changed);
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_INCOME, monthlyIncome.toString());
    }, [monthlyIncome]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_EXPENSE, JSON.stringify(spentData));
    }, [spentData]);

    return {
        monthlyIncome,
        setMonthlyIncome,
        spentData,
        setSpentData,
    };
}
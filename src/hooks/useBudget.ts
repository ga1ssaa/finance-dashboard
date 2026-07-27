// 50/30/20 Rule (50% for necessary expenses, 30% for entertainment, 20% for savings)
import  { useEffect, useState } from "react";

export function useBudget(){

    const [monthlyIncome, setMonthlyIncome] = useState<number>(() => {
        const savedIncome = localStorage.getItem("monthlyIncome");
        // using new changed/saved income or by default 5000
        return savedIncome ? parseFloat(savedIncome) : 5000;
    });

    // Using for saving new income(if it was changed);
    useEffect(() => {
        localStorage.setItem("monthlyIncome", monthlyIncome.toString());
    }, [monthlyIncome]);

    // 50% = 2500 , 30% = 1500 , 20% = 1000

    const [spentData, setSpentData] = useState({
        needs: 2100,
        wants: 1600,
        savings: 500
    });

    return {
        monthlyIncome,
        setMonthlyIncome,
        spentData,
        setSpentData,
    };
}
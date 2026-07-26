import { useState, useEffect } from "react";

const THEME_KEY = "finance_app_theme";

export default function UseTheme(){
    const [isDarkMode, setIsDarkMode] = useState(() => {
        return localStorage.getItem(THEME_KEY) === "dark";
    });

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
            localStorage.setItem(THEME_KEY, 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem(THEME_KEY, 'light');
        }
    }, [isDarkMode]);

    const toggleTheme = () => setIsDarkMode((prev) => !prev);

    return { isDarkMode, toggleTheme };
}
import { useState, useEffect } from "react";

const THEME_KEY = "finance_app_theme";

export default function UseTheme(){
    const [isDarkMode, setIsDarkMode] = useState(() => {
        try { return localStorage.getItem(THEME_KEY) === "dark"; }
        catch { return false; }
    });

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        // Theme persistence is optional; blocked storage must never prevent signing in.
        try { localStorage.setItem(THEME_KEY, isDarkMode ? 'dark' : 'light'); } catch { /* retain in-memory theme */ }
    }, [isDarkMode]);

    const toggleTheme = () => setIsDarkMode((prev) => !prev);

    return { isDarkMode, toggleTheme };
}

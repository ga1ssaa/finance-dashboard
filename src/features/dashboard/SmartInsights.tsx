
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Sparkles } from "lucide-react";
import type { Insight } from "../../hooks/useInsights";

interface SmartInsightsProps {
    insights: Insight[];
};

function SmartInsights({insights}: SmartInsightsProps){

    if(insights.length === 0) return null;
    
    const getStyle = (type: Insight["type"]) => {
        switch(type){
            case "warning":
                return {
                    bg: "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30",
                    text: "text-amber-800 dark:text-amber-300",
                    icon: <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18}/>
                }

            case "success":
                return {
                    bg: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30",
                    text: "text-emerald-800 dark:text-emerald-300",
                    icon: <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18}/>
                }

            case "tip": 
                return {
                    bg: "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30",
                    text: "text-blue-800 dark:text-blue-300",
                    icon: <Lightbulb className="text-blue-500 shrink-0 mt-0.5" size={18}/>
                }
            
            case "info":
            default:
                return {
                    bg: "bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30",
                    text: "text-purple-800 dark:text-purple-300",
                    icon: <Info className="text-purple-500 shrink-0 mt-0.5" size={18}/>
                };
        }
    }
    return(
        <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
                <Sparkles className="text-blue-500" size={18}/>
                <h3 className="font-serif font-bold text-sm uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    AI Smart Insights
                </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {insights.map((item) => {
                    const style = getStyle(item.type);
                    return(
                        <div
                            key = {item.id}
                            className={`p-4 rounded-xl border flex gap-3.5 transition-colors shadow-sm ${style.bg}`}
                        >
                            {style.icon}
                            <div className="space-y-1 ">
                                <h4 className={`font-bold text-sm ${style.text}`}>
                                    {item.title}
                                </h4>
                                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                    {item.message}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
export default SmartInsights
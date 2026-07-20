import DashboardLayout from "./components/DashboardLayout";
import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import { mockTransactions } from "./utils/mockData"

function App(){
    return(
        <DashboardLayout>
            <SummaryCards transactions={mockTransactions} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryPieChart transactions={mockTransactions}/>
                
                <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center justify-center">
                <p className="text-slate-400 font-serif font-medium">
                    Recent Transactions will be there!
                </p>
            </div>
            </div>
        </DashboardLayout>
    );
}
export default App
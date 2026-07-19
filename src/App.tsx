import DashboardLayout from "./components/DashboardLayout";
import SummaryCards from "./features/dashboard/SummaryCards";
import { mockTransactions } from "./utils/mockData"

function App(){
    return(
        <DashboardLayout>
            <SummaryCards transactions={mockTransactions} />
            <div className="mt-8 border-4 border-dashed-4 border-slate-200 rounded-lg h-64 flex items-center justify-center">
                <p className="text-slate-400 font-medium">
                    Charts will be there!
                </p>
            </div>
        </DashboardLayout>
    );
}
export default App
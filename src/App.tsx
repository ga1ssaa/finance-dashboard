import DashboardLayout from "./components/DashboardLayout";
import SummaryCards from "./features/dashboard/SummaryCards";
import CategoryPieChart from "./features/dashboard/CategoryPieChart";
import RecentTransactions from "./features/dashboard/RecentTransactions";
import { mockTransactions } from "./utils/mockData"

function App(){
    return(
        <DashboardLayout>
            <SummaryCards transactions={mockTransactions} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryPieChart transactions={mockTransactions}/>
                <RecentTransactions transactions={mockTransactions} />
            </div>
        </DashboardLayout>
    );
}
export default App
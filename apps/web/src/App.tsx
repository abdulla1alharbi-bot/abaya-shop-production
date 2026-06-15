import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { RequirePermission } from "@/components/auth/RequirePermission";
import { useAuthBootstrap } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/authStore";
import { LoginPage } from "@/pages/auth/LoginPage";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { POSPage } from "@/pages/pos/POSPage";
import { FabricRollsPage } from "@/pages/inventory/FabricRollsPage";
import { ReadyMadeProductsPage } from "@/pages/ready-made/ReadyMadeProductsPage";
import { ReadyConversionsPage } from "@/pages/ready-made/ReadyConversionsPage";
import { ProductionPage } from "@/pages/production/ProductionPage";
import { SampleTailoringPage } from "@/pages/production/SampleTailoringPage";
import { SampleModelPerformancePage } from "@/pages/production/SampleModelPerformancePage";
import { AbayaModelsPage } from "@/pages/models/AbayaModelsPage";
import { JobOrderInvoiceRedirect } from "@/pages/job-orders/JobOrderInvoiceRedirect";
import { WorkersPage } from "@/pages/workers/WorkersPage";
import { PayrollPage } from "@/pages/workers/PayrollPage";
import { CustomersPage } from "@/pages/customers/CustomersPage";
import { InvoicesPage } from "@/pages/invoices/InvoicesPage";
import { AccountsPage } from "@/pages/accounts/AccountsPage";
import { ExpensesPage } from "@/pages/accounts/ExpensesPage";
import { ReportsPage } from "@/pages/reports/ReportsPage";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { UsersPage } from "@/pages/settings/UsersPage";
import { UserForm } from "@/pages/settings/UserForm";
import { AuditLogPage } from "@/pages/settings/AuditLogPage";
import { CustomerDetail } from "@/pages/customers/CustomerDetail";
import { CustomerForm } from "@/pages/customers/CustomerForm";
import { InvoiceDetail } from "@/pages/invoices/InvoiceDetail";
import { InvoiceProcessRedirect } from "@/pages/invoices/InvoiceProcessRedirect";
import { ProductForm } from "@/pages/products/ProductForm";
import { FabricRollForm } from "@/pages/inventory/FabricRollForm";
import { WorkerForm } from "@/pages/workers/WorkerForm";
import { WorkerDetail } from "@/pages/workers/WorkerDetail";
import { ShiftsPage } from "@/pages/shifts/ShiftsPage";
import { WorkshopCapacityPage } from "@/pages/workshop/WorkshopCapacityPage";
import { WorkshopBoardPage } from "@/pages/workshop/WorkshopBoardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { homeRouteForUser } from "@/lib/homeRoute";

function HomeRedirect() {
  const user = useAuthStore((s) => s.user);
  return <Navigate to={homeRouteForUser(user)} replace />;
}

function ProtectedRoute() {
  const ready = useAuthBootstrap();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.accessToken);
  const location = useLocation();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user || !token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

function RedirectReadyMadeEdit() {
  const { id } = useParams();
  return <Navigate to={`/ready-made/${id}/edit`} replace />;
}

function RedirectFabricEdit() {
  const { id } = useParams();
  return <Navigate to={`/fabrics/${id}/edit`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/dashboard"
            element={
              <RequirePermission permission="dashboard.view">
                <DashboardPage />
              </RequirePermission>
            }
          />
          <Route
            path="/pos"
            element={
              <RequirePermission permission="pos.use">
                <POSPage />
              </RequirePermission>
            }
          />
          <Route
            path="/production"
            element={
              <RequirePermission anyOf={["jobProcess.view", "jobProcess.update", "readyMade.create"]}>
                <ProductionPage />
              </RequirePermission>
            }
          />
          <Route
            path="/production/samples"
            element={
              <RequirePermission anyOf={["jobProcess.view", "jobProcess.update", "readyMade.create"]}>
                <SampleTailoringPage />
              </RequirePermission>
            }
          />
          <Route
            path="/production/samples/performance"
            element={
              <RequirePermission permission="reports.sales">
                <SampleModelPerformancePage />
              </RequirePermission>
            }
          />
          <Route
            path="/invoices"
            element={
              <RequirePermission anyOf={["invoices.view", "jobProcess.view"]}>
                <InvoicesPage />
              </RequirePermission>
            }
          />
          <Route path="/workshop" element={<Navigate to="/invoices" replace />} />
          <Route
            path="/invoices/:id/process"
            element={
              <RequirePermission anyOf={["invoices.view", "jobProcess.view"]}>
                <InvoiceProcessRedirect />
              </RequirePermission>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <RequirePermission anyOf={["invoices.view", "jobProcess.view"]}>
                <InvoiceDetail />
              </RequirePermission>
            }
          />
          <Route
            path="/ready-made"
            element={
              <RequirePermission permission="readyMade.view">
                <ReadyMadeProductsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/ready-made/conversions"
            element={
              <RequirePermission anyOf={["readyMade.view", "jobProcess.view"]}>
                <ReadyConversionsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/ready-made/new"
            element={
              <RequirePermission permission="readyMade.create">
                <ProductForm />
              </RequirePermission>
            }
          />
          <Route
            path="/ready-made/:id/edit"
            element={
              <RequirePermission permission="readyMade.edit">
                <ProductForm />
              </RequirePermission>
            }
          />
          <Route
            path="/fabrics"
            element={
              <RequirePermission permission="fabrics.view">
                <FabricRollsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/fabrics/new"
            element={
              <RequirePermission permission="fabrics.create">
                <FabricRollForm />
              </RequirePermission>
            }
          />
          <Route
            path="/fabrics/:id/edit"
            element={
              <RequirePermission permission="fabrics.edit">
                <FabricRollForm />
              </RequirePermission>
            }
          />
          <Route
            path="/models"
            element={
              <RequirePermission permission="models.view">
                <AbayaModelsPage />
              </RequirePermission>
            }
          />
          <Route path="/products" element={<Navigate to="/ready-made" replace />} />
          <Route path="/products/new" element={<Navigate to="/ready-made/new" replace />} />
          <Route path="/products/:id/edit" element={<RedirectReadyMadeEdit />} />
          <Route path="/inventory/fabric-rolls" element={<Navigate to="/fabrics" replace />} />
          <Route path="/inventory/fabric-rolls/new" element={<Navigate to="/fabrics/new" replace />} />
          <Route path="/inventory/fabric-rolls/:id/edit" element={<RedirectFabricEdit />} />
          <Route path="/job-orders" element={<Navigate to="/invoices" replace />} />
          <Route path="/job-orders/new" element={<Navigate to="/pos" replace />} />
          <Route path="/job-orders/:id/edit" element={<Navigate to="/pos" replace />} />
          <Route
            path="/job-orders/:id"
            element={
              <RequirePermission anyOf={["invoices.view", "jobProcess.view"]}>
                <JobOrderInvoiceRedirect />
              </RequirePermission>
            }
          />
          <Route
            path="/workers"
            element={
              <RequirePermission permission="workers.view">
                <WorkersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/workers/new"
            element={
              <RequirePermission permission="workers.create">
                <WorkerForm />
              </RequirePermission>
            }
          />
          <Route
            path="/workers/:id/edit"
            element={
              <RequirePermission permission="workers.edit">
                <WorkerForm />
              </RequirePermission>
            }
          />
          <Route
            path="/workers/:id"
            element={
              <RequirePermission permission="workers.view">
                <WorkerDetail />
              </RequirePermission>
            }
          />
          <Route
            path="/payroll"
            element={
              <RequirePermission permission="workers.wages">
                <PayrollPage />
              </RequirePermission>
            }
          />
          <Route
            path="/customers"
            element={
              <RequirePermission permission="customers.view">
                <CustomersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/customers/new"
            element={
              <RequirePermission permission="customers.create">
                <CustomerForm />
              </RequirePermission>
            }
          />
          <Route
            path="/customers/:id"
            element={
              <RequirePermission permission="customers.view">
                <CustomerDetail />
              </RequirePermission>
            }
          />
          <Route
            path="/reports"
            element={
              <RequirePermission
                anyOf={[
                  "reports.sales",
                  "reports.wages",
                  "reports.balances",
                  "reports.financial",
                  "reports.mostRequested",
                ]}
              >
                <ReportsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/shifts"
            element={
              <RequirePermission permission="pos.use">
                <ShiftsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/workshop/board"
            element={
              <RequirePermission permission="jobProcess.view">
                <WorkshopBoardPage />
              </RequirePermission>
            }
          />
          <Route
            path="/workshop/capacity"
            element={
              <RequirePermission permission="jobProcess.view">
                <WorkshopCapacityPage />
              </RequirePermission>
            }
          />
          <Route
            path="/accounts"
            element={
              <RequirePermission permission="reports.financial">
                <AccountsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/accounts/expenses"
            element={
              <RequirePermission permission="expenses.view">
                <ExpensesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings"
            element={
              <RequirePermission permission="settings.view">
                <SettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/users"
            element={
              <RequirePermission permission="users.view">
                <UsersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/users/new"
            element={
              <RequirePermission permission="users.create">
                <UserForm />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/users/:id/edit"
            element={
              <RequirePermission permission="users.edit">
                <UserForm />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/audit"
            element={
              <RequirePermission permission="audit.view">
                <AuditLogPage />
              </RequirePermission>
            }
          />
          <Route path="/settings/abaya-models" element={<Navigate to="/models" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

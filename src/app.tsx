import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import {
  ErrorNotFoundPage,
  AuthProvider,
  PublicConfigProvider,
  BrandingHead,
  SetupGate,
  ProtectedRoute,
  PublicRoute,
  LoginPage,
  ContinuePage,
} from '@crm/widgets';
import { Toaster } from '@crm/design-system';
import { DashboardShell } from './layouts/DashboardShell';
import { LeadsPage } from './pages/leads/LeadsPage';
import { LeadDetailPage } from './pages/leads/LeadDetailPage';
import { CampaignsPage } from './pages/campaigns/CampaignsPage';
import { CampaignCreatePage } from './pages/campaigns/CampaignCreatePage';
import { CampaignDetailPage } from './pages/campaigns/CampaignDetailPage';
import { WorkflowsPage } from './pages/workflows/WorkflowsPage';
import { WorkflowEditorPage } from './pages/workflows/WorkflowEditorPage';
import { WorkflowDetailPage } from './pages/workflows/WorkflowDetailPage';
import { ConsentPage } from './pages/consent/ConsentPage';
import { DesignSystemPage } from './pages/design-system/DesignSystemPage';
import { SetupWizardPage } from './pages/setup/SetupWizardPage';
import { TeamPage } from './pages/settings/TeamPage';
import { BrandingPage } from './pages/settings/BrandingPage';
import { EmailPage } from './pages/settings/EmailPage';
import { PropertiesPage } from './pages/settings/PropertiesPage';
import { LeadListsPage } from './pages/settings/LeadListsPage';
import { LifecyclePage } from './pages/settings/LifecyclePage';
import { CompaniesPage } from './pages/companies/CompaniesPage';
import { CompanyDetailPage } from './pages/companies/CompanyDetailPage';
import { DealsPage } from './pages/deals/DealsPage';
import { DealDetailPage } from './pages/deals/DealDetailPage';
import { PipelinesPage } from './pages/settings/PipelinesPage';
import { TasksPage } from './pages/tasks/TasksPage';

function NotFoundPage() {
  const navigate = useNavigate();
  return <ErrorNotFoundPage onGoHome={() => navigate('/leads')} onGoBack={() => navigate(-1)} />;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Setup gate wraps every route: a fresh deployment redirects to /setup
          before login/homepage; a configured one keeps users off /setup. */}
      <Route element={<SetupGate />}>
        {/* First-run configuration wizard */}
        <Route path="/setup" element={<SetupWizardPage />} />

        {/* Public, unauthenticated RGPD consent page (token in URL) */}
        <Route path="/consent/:token" element={<ConsentPage />} />

        <Route
          path="/login"
          element={
            <PublicRoute redirectTo="/leads">
              <LoginPage
                homePath="/leads"
                title="CRM"
                subtitle="Connectez-vous à votre espace CRM"
              />
            </PublicRoute>
          }
        />
        <Route path="/auth/continue" element={<ContinuePage homePath="/leads" />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardShell />}>
            <Route path="/" element={<Navigate to="/leads" replace />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/leads/:leadId" element={<LeadDetailPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:companyId" element={<CompanyDetailPage />} />
            <Route path="/deals" element={<DealsPage />} />
            <Route path="/deals/:dealId" element={<DealDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/new" element={<CampaignCreatePage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignDetailPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/workflows/new" element={<WorkflowEditorPage />} />
            <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
            <Route path="/workflows/:workflowId/edit" element={<WorkflowEditorPage />} />
            <Route path="/settings/team" element={<TeamPage />} />
            <Route path="/settings/branding" element={<BrandingPage />} />
            <Route path="/settings/email" element={<EmailPage />} />
            <Route path="/settings/properties" element={<PropertiesPage />} />
            <Route path="/settings/lists" element={<LeadListsPage />} />
            <Route path="/settings/lifecycle" element={<LifecyclePage />} />
            <Route path="/settings/pipelines" element={<PipelinesPage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PublicConfigProvider>
        <BrandingHead />
        <AuthProvider>
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </PublicConfigProvider>
    </BrowserRouter>
  );
}

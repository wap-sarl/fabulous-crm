import { type ComponentType, lazy, Suspense } from 'react';
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
import { Spinner, Toaster } from '@crm/design-system';
import { DashboardShell } from './layouts/DashboardShell';
import { SettingsLayout } from './layouts/SettingsLayout';
import { isSettingsPath, SETTINGS_ROOT } from './lib/settingsTabs';
import { RequireModule } from './features/access/components/RequireModule';
import { extensions } from './extensions';

/** A page is loaded when its route is first opened: the first screen carries the shell and nothing of the pages it does not show. */
const page = <Name extends string>(load: () => Promise<Record<Name, ComponentType>>, name: Name) =>
  lazy(() => load().then((module) => ({ default: module[name] })));

const LeadsPage = page(() => import('./pages/leads/LeadsPage'), 'LeadsPage');
const LeadDetailPage = page(() => import('./pages/leads/LeadDetailPage'), 'LeadDetailPage');
const CampaignsPage = page(() => import('./pages/campaigns/CampaignsPage'), 'CampaignsPage');
const CampaignCreatePage = page(
  () => import('./pages/campaigns/CampaignCreatePage'),
  'CampaignCreatePage',
);
const CampaignDetailPage = page(
  () => import('./pages/campaigns/CampaignDetailPage'),
  'CampaignDetailPage',
);
const WorkflowsPage = page(() => import('./pages/workflows/WorkflowsPage'), 'WorkflowsPage');
const WorkflowEditorPage = page(
  () => import('./pages/workflows/WorkflowEditorPage'),
  'WorkflowEditorPage',
);
const WorkflowDetailPage = page(
  () => import('./pages/workflows/WorkflowDetailPage'),
  'WorkflowDetailPage',
);
const ConsentPage = page(() => import('./pages/consent/ConsentPage'), 'ConsentPage');
const DesignSystemPage = page(
  () => import('./pages/design-system/DesignSystemPage'),
  'DesignSystemPage',
);
const SetupWizardPage = page(() => import('./pages/setup/SetupWizardPage'), 'SetupWizardPage');
const TeamPage = page(() => import('./pages/settings/TeamPage'), 'TeamPage');
const BrandingPage = page(() => import('./pages/settings/BrandingPage'), 'BrandingPage');
const EmailPage = page(() => import('./pages/settings/EmailPage'), 'EmailPage');
const PropertiesPage = page(() => import('./pages/settings/PropertiesPage'), 'PropertiesPage');
const DuplicatesPage = page(() => import('./pages/leads/DuplicatesPage'), 'DuplicatesPage');
const ImportPage = page(() => import('./pages/imports/ImportPage'), 'ImportPage');
const ImportJobPage = page(() => import('./pages/imports/ImportJobPage'), 'ImportJobPage');
const TrackingPage = page(() => import('./pages/settings/TrackingPage'), 'TrackingPage');
const FilesPage = page(() => import('./pages/settings/FilesPage'), 'FilesPage');
const RetentionPage = page(() => import('./pages/settings/RetentionPage'), 'RetentionPage');
const RolesPage = page(() => import('./pages/settings/RolesPage'), 'RolesPage');
const LeadListsPage = page(() => import('./pages/settings/LeadListsPage'), 'LeadListsPage');
const LifecyclePage = page(() => import('./pages/settings/LifecyclePage'), 'LifecyclePage');
const ScoringPage = page(() => import('./pages/settings/ScoringPage'), 'ScoringPage');
const ApiKeysPage = page(() => import('./pages/settings/ApiKeysPage'), 'ApiKeysPage');
const IntegrationsPage = page(
  () => import('./pages/settings/IntegrationsPage'),
  'IntegrationsPage',
);
const FormsPage = page(() => import('./pages/settings/FormsPage'), 'FormsPage');
const CompaniesPage = page(() => import('./pages/companies/CompaniesPage'), 'CompaniesPage');
const CompanyDetailPage = page(
  () => import('./pages/companies/CompanyDetailPage'),
  'CompanyDetailPage',
);
const DealsPage = page(() => import('./pages/deals/DealsPage'), 'DealsPage');
const DealDetailPage = page(() => import('./pages/deals/DealDetailPage'), 'DealDetailPage');
const PipelinesPage = page(() => import('./pages/settings/PipelinesPage'), 'PipelinesPage');
const TasksPage = page(() => import('./pages/tasks/TasksPage'), 'TasksPage');

function NotFoundPage() {
  const navigate = useNavigate();
  return <ErrorNotFoundPage onGoHome={() => navigate('/leads')} onGoBack={() => navigate(-1)} />;
}

/** A route of an overlay under `/settings/` is shown inside the settings page, with its tab. */
const inSettings = (route: { path: string }) => isSettingsPath(route.path);

/** Shown while a page outside the shell (setup, consent) is being loaded. */
const pageLoading = (
  <div className="flex min-h-screen items-center justify-center">
    <Spinner size="lg" />
  </div>
);

function AppRoutes() {
  return (
    <Suspense fallback={pageLoading}>
      <Routes>
        {/* The setup gate wraps every route: a fresh deployment is sent to /setup before anything else, a configured one is kept off it. */}
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
              <Route element={<RequireModule />}>
                <Route path="/leads" element={<LeadsPage />} />
                <Route path="/leads/duplicates" element={<DuplicatesPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/import/:jobId" element={<ImportJobPage />} />
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
              </Route>
              {/* Every setting is a tab of one page; a tab keeps the address it had. */}
              <Route path={SETTINGS_ROOT} element={<SettingsLayout />}>
                <Route path="/settings/team" element={<TeamPage />} />
                <Route path="/settings/branding" element={<BrandingPage />} />
                <Route path="/settings/email" element={<EmailPage />} />
                <Route path="/settings/properties" element={<PropertiesPage />} />
                <Route path="/settings/lists" element={<LeadListsPage />} />
                <Route path="/settings/lifecycle" element={<LifecyclePage />} />
                <Route path="/settings/scoring" element={<ScoringPage />} />
                <Route path="/settings/api" element={<ApiKeysPage />} />
                <Route path="/settings/integrations" element={<IntegrationsPage />} />
                <Route path="/settings/forms" element={<FormsPage />} />
                <Route path="/settings/pipelines" element={<PipelinesPage />} />
                <Route path="/settings/files" element={<FilesPage />} />
                <Route path="/settings/retention" element={<RetentionPage />} />
                <Route path="/settings/tracking" element={<TrackingPage />} />
                <Route path="/settings/roles" element={<RolesPage />} />
                {extensions.routes.filter(inSettings).map((route) => (
                  <Route key={route.path} path={route.path} element={route.element} />
                ))}
              </Route>
              <Route path="/design-system" element={<DesignSystemPage />} />
              {extensions.routes
                .filter((route) => !inSettings(route))
                .map((route) => (
                  <Route key={route.path} path={route.path} element={route.element} />
                ))}
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
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

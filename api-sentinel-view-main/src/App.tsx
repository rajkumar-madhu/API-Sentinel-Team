import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth-context";
import { RealtimeProvider } from "@/lib/realtime";
import { OnboardingProvider } from "@/lib/onboarding-context";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AppShellFallback from "@/components/layout/AppShellFallback";
import RootRedirect from "@/components/auth/RootRedirect";
import LegacyRouteRedirect from "@/components/routing/LegacyRouteRedirect";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const AccessRestricted = lazy(() => import("./pages/AccessRestricted"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CustomerLayout = lazy(() => import("./customer/layouts/CustomerLayout"));
const AdminLayout = lazy(() => import("./admin/layouts/AdminLayout"));
const PlatformLayout = lazy(() => import("./platform/layouts/PlatformLayout"));
const Organization = lazy(() => import("./customer/pages/organization/Organization"));
const Dashboard = lazy(() => import("./customer/pages/dashboard/Dashboard"));
const DiscoveryLayout = lazy(() => import("./customer/pages/discovery/DiscoveryLayout"));
const ApiCatalogue = lazy(() => import("./customer/pages/discovery/ApiCatalogue"));
const ParameterCatalogue = lazy(() => import("./customer/pages/discovery/ParameterCatalogue"));
const ApiGovernance = lazy(() => import("./customer/pages/discovery/ApiGovernance"));
const ApiSequenceFlow = lazy(() => import("./customer/pages/discovery/ApiSequenceFlow"));
const ApiTree = lazy(() => import("./customer/pages/discovery/ApiTree"));
const BusinessLogicGraph = lazy(() => import("./customer/pages/discovery/BusinessLogicGraph"));
const SchemaValidation = lazy(() => import("./customer/pages/discovery/SchemaValidation"));
const SensitiveData = lazy(() => import("./customer/pages/discovery/SensitiveData"));
const AgenticSecurity = lazy(() => import("./customer/pages/intelligence/AgenticSecurity"));
const McpShield = lazy(() => import("./customer/pages/protection/McpShield"));
const TestingLayout = lazy(() => import("./customer/pages/testing/TestingLayout"));
const Vulnerabilities = lazy(() => import("./customer/pages/testing/Vulnerabilities"));
const TestDashboard = lazy(() => import("./customer/pages/testing/TestDashboard"));
const TestConfiguration = lazy(() => import("./customer/pages/testing/TestConfiguration"));
const TestInspector = lazy(() => import("./customer/pages/testing/TestInspector"));
const ReleaseGovernance = lazy(() => import("./customer/pages/testing/ReleaseGovernance"));
const ProtectionLayout = lazy(() => import("./customer/pages/protection/ProtectionLayout"));
const SecurityEvents = lazy(() => import("./customer/pages/protection/SecurityEvents"));
const ThreatActors = lazy(() => import("./customer/pages/protection/ThreatActors"));
const EnforcementHistory = lazy(() => import("./customer/pages/protection/EnforcementHistory"));
const PolicyConfiguration = lazy(() => import("./customer/pages/protection/PolicyConfiguration"));
const ProtectionSettings = lazy(() => import("./customer/pages/protection/ProtectionSettings"));
const Reports = lazy(() => import("./customer/pages/reports/Reports"));
const ThreatIntelligence = lazy(() => import("./customer/pages/intelligence/ThreatIntelligence"));
const LiveFeed = lazy(() => import("./customer/pages/live/LiveFeed"));
const AlertCenter = lazy(() => import("./customer/pages/alerts/AlertCenter"));
const BlockList = lazy(() => import("./customer/pages/protection/BlockList"));
const SettingsPage = lazy(() => import("./admin/pages/settings/SettingsPage"));
const UserManagement = lazy(() => import("./admin/pages/settings/UserManagement"));
const AuditLogs = lazy(() => import("./admin/pages/settings/AuditLogs"));
const AddApplication = lazy(() => import("./admin/pages/settings/AddApplication"));
const ApiKeysManagement = lazy(() => import("./admin/pages/settings/ApiKeysManagement"));
const LicenseUsage = lazy(() => import("./admin/pages/settings/LicenseUsage"));
const AttributeMapping = lazy(() => import("./admin/pages/settings/AttributeMapping"));
const IntegrationsSettings = lazy(() => import("./admin/pages/settings/IntegrationsSettings"));
const SystemHealthLayout = lazy(() => import("./admin/pages/system-health/SystemHealthLayout"));
const ControllerHealth = lazy(() => import("./admin/pages/system-health/ControllerHealth"));
const SensorHealth = lazy(() => import("./admin/pages/system-health/SensorHealth"));
const EnforcerHealth = lazy(() => import("./admin/pages/system-health/EnforcerHealth"));
const OperationsDashboard = lazy(() => import("./admin/pages/operations/OperationsDashboard"));
const PlatformOverview = lazy(() => import("./platform/pages/PlatformOverview"));
const TenantDirectory = lazy(() => import("./platform/pages/TenantDirectory"));
const InfrastructureStatus = lazy(() => import("./platform/pages/InfrastructureStatus"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Per-route hooks set refetchInterval where live data is needed; avoid global polling.
      refetchInterval: false,
      refetchIntervalInBackground: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <RealtimeProvider>
      <OnboardingProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ErrorBoundary>
              <Suspense fallback={<AppShellFallback />}>
                <Routes>
                  <Route path="/" element={<RootRedirect />} />
                  <Route path="/welcome" element={<Landing />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/access-restricted" element={<AccessRestricted />} />

                  <Route element={<ProtectedRoute workspace="customer"><CustomerLayout /></ProtectedRoute>}>
                    <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
                    <Route path="/app/organization" element={<Organization />} />
                    <Route path="/app/dashboard" element={<Dashboard />} />

                    <Route path="/app/discovery" element={<DiscoveryLayout />}>
                      <Route index element={<ApiCatalogue />} />
                      <Route path="parameters" element={<ParameterCatalogue />} />
                      <Route path="governance" element={<ApiGovernance />} />
                      <Route path="sequence" element={<ApiSequenceFlow />} />
                      <Route path="tree" element={<ApiTree />} />
                      <Route path="call-graph" element={<BusinessLogicGraph />} />
                      <Route path="schema" element={<SchemaValidation />} />
                      <Route path="sensitive-data" element={<SensitiveData />} />
                    </Route>

                    <Route path="/app/testing" element={<TestingLayout />}>
                      <Route index element={<Vulnerabilities />} />
                      <Route path="dashboard" element={<TestDashboard />} />
                      <Route path="configuration" element={<TestConfiguration />} />
                      <Route path="inspector" element={<TestInspector />} />
                      <Route path="governance" element={<ReleaseGovernance />} />
                    </Route>

                    <Route path="/app/protection" element={<ProtectionLayout />}>
                      <Route index element={<SecurityEvents />} />
                      <Route path="threats" element={<ThreatActors />} />
                      <Route path="enforcement" element={<EnforcementHistory />} />
                      <Route path="policy" element={<PolicyConfiguration />} />
                      <Route path="settings" element={<ProtectionSettings />} />
                      <Route path="mcp-shield" element={<McpShield />} />
                    </Route>

                    <Route path="/app/reports" element={<Reports />} />
                    <Route path="/app/intelligence" element={<ThreatIntelligence />} />
                    <Route path="/app/intelligence/agentic" element={<AgenticSecurity />} />
                    <Route path="/app/live" element={<LiveFeed />} />
                    <Route path="/app/alerts" element={<AlertCenter />} />
                    <Route path="/app/blocklist" element={<BlockList />} />
                  </Route>

                  <Route element={<ProtectedRoute workspace="admin"><AdminLayout /></ProtectedRoute>}>
                    <Route path="/admin" element={<Navigate to="/admin/onboarding" replace />} />
                    <Route path="/admin/onboarding" element={<Onboarding />} />
                    <Route path="/admin/applications/add" element={<AddApplication />} />
                    <Route path="/admin/settings" element={<SettingsPage />} />
                    <Route path="/admin/settings/users" element={<UserManagement />} />
                    <Route path="/admin/settings/audit-logs" element={<AuditLogs />} />
                    <Route path="/admin/settings/api-keys" element={<ApiKeysManagement />} />
                    <Route path="/admin/settings/license" element={<LicenseUsage />} />
                    <Route path="/admin/settings/attribute-mapping" element={<AttributeMapping />} />
                    <Route path="/admin/settings/integrations" element={<IntegrationsSettings />} />
                    <Route path="/admin/system-health" element={<SystemHealthLayout />}>
                      <Route index element={<ControllerHealth />} />
                      <Route path="controllers" element={<ControllerHealth />} />
                      <Route path="sensors" element={<SensorHealth />} />
                      <Route path="enforcers" element={<EnforcerHealth />} />
                    </Route>
                    <Route path="/admin/operations" element={<OperationsDashboard />} />
                  </Route>

                  <Route element={<ProtectedRoute workspace="platform"><PlatformLayout /></ProtectedRoute>}>
                    <Route path="/platform" element={<Navigate to="/platform/overview" replace />} />
                    <Route path="/platform/overview" element={<PlatformOverview />} />
                    <Route path="/platform/tenants" element={<TenantDirectory />} />
                    <Route path="/platform/infrastructure" element={<InfrastructureStatus />} />
                  </Route>

                  <Route path="/organization" element={<LegacyRouteRedirect />} />
                  <Route path="/dashboard" element={<LegacyRouteRedirect />} />
                  <Route path="/discovery/*" element={<LegacyRouteRedirect />} />
                  <Route path="/testing/*" element={<LegacyRouteRedirect />} />
                  <Route path="/protection/*" element={<LegacyRouteRedirect />} />
                  <Route path="/reports" element={<LegacyRouteRedirect />} />
                  <Route path="/intelligence" element={<LegacyRouteRedirect />} />
                  <Route path="/live" element={<LegacyRouteRedirect />} />
                  <Route path="/alerts" element={<LegacyRouteRedirect />} />
                  <Route path="/blocklist" element={<LegacyRouteRedirect />} />
                  <Route path="/onboarding" element={<LegacyRouteRedirect />} />
                  <Route path="/settings/*" element={<LegacyRouteRedirect />} />
                  <Route path="/system-health/*" element={<LegacyRouteRedirect />} />
                  <Route path="/operations" element={<LegacyRouteRedirect />} />
                  <Route path="/add-application" element={<LegacyRouteRedirect />} />

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </OnboardingProvider>
      </RealtimeProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

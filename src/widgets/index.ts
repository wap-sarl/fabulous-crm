export { DashboardLayout, type NavItem } from './layouts/DashboardLayout';
export { ErrorNotFoundPage } from './pages/ErrorNotFoundPage';
export { ConvexProvider } from './providers/ConvexProvider';
export {
  useAuthQuery,
  useAuthPaginatedQuery,
  useAuthMutation,
  useAuthAction,
} from './convex-auth';
export {
  AuthProvider,
  useAuth,
  ProtectedRoute,
  PublicRoute,
  SetupGate,
  LoginPage,
  ContinuePage,
} from './auth';
export { PublicConfigProvider, usePublicConfig } from './config';
export { BrandingHead, ImageUploadField } from './config';
export {
  ColorPickerField,
  applyPrimaryColor,
  resetPrimaryColor,
  bootstrapPrimaryColor,
} from './config';

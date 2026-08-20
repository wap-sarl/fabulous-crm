export { DashboardLayout, type NavItem } from './layouts/DashboardLayout';
export { ErrorNotFoundPage } from './pages/ErrorNotFoundPage';
export { ConvexProvider } from './providers/ConvexProvider';
export {
  TokenProvider,
  useGuestToken,
  useAuthQuery,
  useAuthPaginatedQuery,
  useAuthMutation,
  useAuthAction,
  useGuestQuery,
  useGuestMutation,
  useGuestAction,
} from './convex-auth';
export {
  AuthProvider,
  useAuth,
  authClient,
  ProtectedRoute,
  PublicRoute,
  SetupGate,
  LoginPage,
  type LoginPageProps,
  ContinuePage,
  type ContinuePageProps,
} from './auth';
export { PublicConfigProvider, usePublicConfig, type PublicConfig } from './config';
export { BrandingHead, ImageUploadField, type ImageUploadFieldProps } from './config';
export {
  ColorPickerField,
  type ColorPickerFieldProps,
  DEFAULT_PRIMARY_COLOR,
  applyPrimaryColor,
  resetPrimaryColor,
  bootstrapPrimaryColor,
} from './config';

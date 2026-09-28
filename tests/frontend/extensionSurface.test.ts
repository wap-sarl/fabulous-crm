import { describe, expect, test } from 'bun:test';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  PageHeader,
  Progress,
  Spinner,
  StatusBadge,
  type StatusTone,
  toast,
} from '../../src/design-system';
import { usePageTitle } from '../../src/layouts/DashboardShell';
import { describeError } from '../../src/lib/errors';
import type { FrontendExtensions, LoginMethods, Refusal } from '../../src/lib/extensionTypes';
import {
  useAuth,
  useAuthMutation,
  useAuthPaginatedQuery,
  useAuthQuery,
  usePublicConfig,
} from '../../src/widgets';
import { DecorativeSquares, LargeErrorCode } from '../../src/widgets/pages/ErrorPageShared';

// What an overlay builds on besides the three files it replaces (docs/extensions.md): a name that moves breaks it, so it breaks here first.

/** The types an overlay names. */
export type FrontendTypes = [StatusTone, FrontendExtensions, LoginMethods, Refusal];

const VALUES = {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  PageHeader,
  Progress,
  Spinner,
  StatusBadge,
  toast,
  usePageTitle,
  describeError,
  useAuth,
  useAuthMutation,
  useAuthPaginatedQuery,
  useAuthQuery,
  usePublicConfig,
  DecorativeSquares,
  LargeErrorCode,
};

describe('what an overlay builds on, frontend', () => {
  test('every value it imports is there', () => {
    const missing = Object.entries(VALUES)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

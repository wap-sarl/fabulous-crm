import { type Infer, v } from 'convex/values';
import {
  addressValidator,
  firstAndLastNameValidator,
  logsValidator,
  softDeleteValidator,
} from './shared';

/** A `roles.key`, built-in or custom: its access matrix decides what the employee sees (lib/roles/visibility.ts). */
export const employeeRoleValidator = v.string();
export type EmployeeRole = Infer<typeof employeeRoleValidator>;

export const employeeValidator = v.object({
  ...firstAndLastNameValidator.fields,
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  type: v.literal('employee'),
  role: v.optional(employeeRoleValidator),
  // The Better Auth `user._id`, set by the auth onCreate trigger; optional so seed rows stay valid.
  authId: v.optional(v.string()),
  birthDate: v.string(),
  jobTitle: v.string(),
  email: v.string(),
  phone: v.string(),
  address: addressValidator,
});

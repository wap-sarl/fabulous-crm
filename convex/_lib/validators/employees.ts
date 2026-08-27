import { type Infer, v } from 'convex/values';
import {
  addressValidator,
  firstAndLastNameValidator,
  logsValidator,
  softDeleteValidator,
} from './shared';

/**
 * A role key (`roles.key`): `admin`, `manager`, `member` or a custom role.
 * The key's access matrix decides what the employee sees (lib/visibility.ts).
 */
export const employeeRoleValidator = v.string();
export type EmployeeRole = Infer<typeof employeeRoleValidator>;

export const employeeValidator = v.object({
  ...firstAndLastNameValidator.fields,
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  type: v.literal('employee'),
  role: v.optional(employeeRoleValidator),
  // Link to the Better Auth user (component-owned `user._id`). Optional so
  // pre-migration/seed rows remain valid; set by the auth onCreate trigger.
  authId: v.optional(v.string()),
  birthDate: v.string(),
  jobTitle: v.string(),
  email: v.string(),
  phone: v.string(),
  address: addressValidator,
});

export type Employee = Infer<typeof employeeValidator>;

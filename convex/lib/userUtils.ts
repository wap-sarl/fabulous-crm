import type { RoleAccess } from '../_lib/validators/access';

/** The session user the frontend relies on: identity, role and its access matrix. */
export function serializeUser(
  user: {
    _id: string;
    type: 'employee';
    email: string;
    firstName: string;
    lastName: string;
    role?: string;
  },
  role: { key: string; label: string; access: RoleAccess },
) {
  return {
    _id: user._id,
    email: user.email,
    type: user.type,
    role: role.key,
    roleLabel: role.label,
    access: role.access,
    name: `${user.firstName} ${user.lastName}`,
  };
}

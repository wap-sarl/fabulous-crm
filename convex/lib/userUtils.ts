export function serializeUser(user: {
  _id: string;
  type: 'employee';
  email: string;
  firstName: string;
  lastName: string;
  role?: 'admin' | 'manager' | 'member';
}) {
  return {
    _id: user._id,
    email: user.email,
    type: user.type,
    role: user.role ?? 'member',
    name: `${user.firstName} ${user.lastName}`,
  };
}

import { Infer } from 'convex/values';
import { employeeValidator } from './employees';

export const userValidator = employeeValidator;

export type User = Infer<typeof userValidator>;

export { employeeValidator } from './employees';
export type { Employee } from './employees';

import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';

export const teamValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  memberIds: v.array(v.id('users')),
});

export type Team = Infer<typeof teamValidator>;

export const MAX_TEAM_NAME_LENGTH = 60;

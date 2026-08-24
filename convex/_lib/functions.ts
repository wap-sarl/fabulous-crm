import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';
import { Triggers } from 'convex-helpers/server/triggers';
import type { DataModel } from '../_generated/dataModel';
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from '../_generated/server';
import { leadsByOwner, leadsByStatus } from '../lib/leadAggregates';

const triggers = new Triggers<DataModel>();
triggers.register('leads', leadsByStatus.trigger());
triggers.register('leads', leadsByOwner.trigger());

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));

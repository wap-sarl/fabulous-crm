import { internal } from '../../_generated/api';
import type { ApiScope } from '../../_lib/validators/apiKeys';
import {
  activityCreateBody,
  activityPatchBody,
  companyCreateBody,
  companyPatchBody,
  contactCreateBody,
  contactPatchBody,
  dealCreateBody,
  dealPatchBody,
  parseBody,
  READ_ONLY_FIELDS,
} from './bodies';
import {
  type Method,
  type ApiRoute,
  ok,
  noContent,
  notFound,
  errorResult,
  paginationOptsOf,
} from './http';

// Routes

const q = internal.features.api.internal;
const w = internal.features.api.writes;

export const ROUTES: ApiRoute[] = [
  {
    method: 'GET',
    pattern: 'me',
    handler: async (_ctx, { key }) =>
      ok({
        name: key.name,
        keyId: key.keyId,
        scopes: key.scopes,
        expiresAt: key.expiresAt ?? null,
      }),
  },

  // Contacts
  {
    method: 'GET',
    pattern: 'contacts',
    scope: 'contacts:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listContacts, {
          paginationOpts: paginationOptsOf(url),
          email: url.searchParams.get('email') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'contacts/:id',
    scope: 'contacts:read',
    handler: async (ctx, { params }) => {
      const contact = await ctx.runQuery(q.getContact, { id: params.id });
      return contact ? ok(contact) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'contacts',
    scope: 'contacts:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createContact, {
          apiKeyId: key._id,
          body: parseBody(contactCreateBody, body, READ_ONLY_FIELDS.contacts),
        }),
        201,
      ),
  },
  {
    method: 'POST',
    pattern: 'contacts/upsert',
    scope: 'contacts:write',
    handler: async (ctx, { key, body }) => {
      const result = await ctx.runMutation(w.upsertContact, {
        apiKeyId: key._id,
        body: parseBody(contactCreateBody, body, READ_ONLY_FIELDS.contacts),
      });
      return ok(result, result.created ? 201 : 200);
    },
  },
  {
    method: 'PATCH',
    pattern: 'contacts/:id',
    scope: 'contacts:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateContact, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(contactPatchBody, body, READ_ONLY_FIELDS.contacts),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'contacts/:id',
    scope: 'contacts:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteContact, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Companies
  {
    method: 'GET',
    pattern: 'companies',
    scope: 'companies:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listCompanies, {
          paginationOpts: paginationOptsOf(url),
          domain: url.searchParams.get('domain') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'companies/:id',
    scope: 'companies:read',
    handler: async (ctx, { params }) => {
      const company = await ctx.runQuery(q.getCompany, { id: params.id });
      return company ? ok(company) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'companies',
    scope: 'companies:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createCompany, {
          apiKeyId: key._id,
          body: parseBody(companyCreateBody, body, READ_ONLY_FIELDS.companies),
        }),
        201,
      ),
  },
  {
    method: 'PATCH',
    pattern: 'companies/:id',
    scope: 'companies:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateCompany, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(companyPatchBody, body, READ_ONLY_FIELDS.companies),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'companies/:id',
    scope: 'companies:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteCompany, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Deals
  {
    method: 'GET',
    pattern: 'deals',
    scope: 'deals:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listDeals, {
          paginationOpts: paginationOptsOf(url),
          leadId: url.searchParams.get('leadId') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'deals/:id',
    scope: 'deals:read',
    handler: async (ctx, { params }) => {
      const deal = await ctx.runQuery(q.getDeal, { id: params.id });
      return deal ? ok(deal) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'deals',
    scope: 'deals:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createDeal, {
          apiKeyId: key._id,
          body: parseBody(dealCreateBody, body, READ_ONLY_FIELDS.deals),
        }),
        201,
      ),
  },
  {
    method: 'PATCH',
    pattern: 'deals/:id',
    scope: 'deals:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateDeal, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(dealPatchBody, body, READ_ONLY_FIELDS.deals),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'deals/:id',
    scope: 'deals:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteDeal, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Activities
  {
    method: 'GET',
    pattern: 'activities',
    scope: 'activities:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listActivities, {
          paginationOpts: paginationOptsOf(url),
          leadId: url.searchParams.get('leadId') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'activities/:id',
    scope: 'activities:read',
    handler: async (ctx, { params }) => {
      const activity = await ctx.runQuery(q.getActivity, { id: params.id });
      return activity ? ok(activity) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'activities',
    scope: 'activities:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createActivity, {
          apiKeyId: key._id,
          body: parseBody(activityCreateBody, body, READ_ONLY_FIELDS.activities),
        }),
        201,
      ),
  },
  {
    method: 'PATCH',
    pattern: 'activities/:id',
    scope: 'activities:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateActivity, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(activityPatchBody, body, READ_ONLY_FIELDS.activities),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'activities/:id',
    scope: 'activities:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteActivity, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Read-only resources
  {
    method: 'GET',
    pattern: 'lists',
    scope: 'lists:read',
    handler: async (ctx, { url }) =>
      ok(await ctx.runQuery(q.listLists, { paginationOpts: paginationOptsOf(url) })),
  },
  {
    method: 'GET',
    pattern: 'lists/:id/members',
    // Members are full contact DTOs: the list scope alone must not open contact data.
    scope: ['lists:read', 'contacts:read'],
    handler: async (ctx, { url, params }) => {
      const members = await ctx.runQuery(q.listListMembers, {
        listId: params.id,
        paginationOpts: paginationOptsOf(url),
      });
      return members ? ok(members) : notFound('No such list.');
    },
  },
  {
    method: 'GET',
    pattern: 'properties',
    scope: 'properties:read',
    handler: async (ctx, { url }) => {
      const entityType = url.searchParams.get('entityType');
      if (!entityType) {
        return errorResult(400, 'missing_entity_type', 'The entityType parameter is required.');
      }
      const result = await ctx.runQuery(q.listProperties, {
        entityType,
        paginationOpts: paginationOptsOf(url),
      });
      return result ? ok(result) : errorResult(400, 'invalid_entity_type', 'Unknown entityType.');
    },
  },
];

/** Every route of the table — the OpenAPI spec test checks the document against it. */
export const API_ROUTE_TABLE: readonly {
  method: Method;
  pattern: string;
  scope?: ApiScope | ApiScope[];
}[] = ROUTES.map(({ method, pattern, scope }) => ({ method, pattern, scope }));

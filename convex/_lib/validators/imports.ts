import { type Infer, v } from 'convex/values';
import { activityStatusValidator, activityTypeValidator } from './activities';
import { addressValidator } from './shared';
import { propertyValueValidator } from './properties';

/** What a file can be imported as; each entity has its own field registry (SPA) and its own upsert rules (features/imports/entities). */
export const importEntityValidator = v.union(
  v.literal('lead'),
  v.literal('company'),
  v.literal('deal'),
  v.literal('activity'),
);
export type ImportEntity = Infer<typeof importEntityValidator>;
export const IMPORT_ENTITIES: ImportEntity[] = ['lead', 'company', 'deal', 'activity'];

/** Rows handled per scheduled batch; an update writes several documents, so this stays well under the transaction limit. */
export const IMPORT_BATCH_SIZE = 200;
/** Rows sent per upload mutation from the SPA. */
export const IMPORT_UPLOAD_CHUNK = 500;
/** Rows a single import may hold. */
export const IMPORT_MAX_ROWS = 50_000;
/** Rows in error returned for the error-file export. */
export const IMPORT_ERROR_EXPORT_CAP = 5_000;

/** A column mapping saved for a source (a HubSpot export, an Excel file): the headers seen and the target of each. */
export const importMappingValidator = v.object({
  entity: importEntityValidator,
  name: v.string(),
  headers: v.array(v.string()),
  // Target ids per header, `null` for a column to ignore; see the SPA's field registries.
  targets: v.array(v.union(v.string(), v.null())),
  updatedAt: v.number(),
  createdBy: v.id('users'),
  updatedBy: v.id('users'),
});
export type ImportMapping = Infer<typeof importMappingValidator>;

export const importJobStatusValidator = v.union(
  // Rows are being uploaded.
  v.literal('uploading'),
  // The dry run is going through the rows, nothing is written to the CRM.
  v.literal('simulating'),
  // The dry run is done: creations, updates, duplicates and errors are known.
  v.literal('simulated'),
  // The rows are being written, batch by batch.
  v.literal('running'),
  // A batch threw; the job resumes from that batch on demand.
  v.literal('interrupted'),
  v.literal('done'),
  v.literal('cancelled'),
);
export type ImportJobStatus = Infer<typeof importJobStatusValidator>;

/** What the dry run or the run did with the rows so far. */
export const importCountsValidator = v.object({
  created: v.number(),
  updated: v.number(),
  duplicates: v.number(),
  errors: v.number(),
});
export type ImportCounts = Infer<typeof importCountsValidator>;
export const emptyImportCounts = (): ImportCounts => ({
  created: 0,
  updated: 0,
  duplicates: 0,
  errors: 0,
});

export const importJobValidator = v.object({
  entity: importEntityValidator,
  fileName: v.string(),
  status: importJobStatusValidator,
  // The phase a batch was in when it threw, for the resume.
  interruptedFrom: v.optional(v.union(v.literal('simulating'), v.literal('running'))),
  error: v.optional(v.string()),
  headers: v.array(v.string()),
  targets: v.array(v.union(v.string(), v.null())),
  mappingId: v.optional(v.id('importMappings')),
  // Leads only: the static list every created or updated contact joins.
  listId: v.optional(v.id('leadLists')),
  // Leads only: what to do with a row that looks like an existing contact without sharing its email.
  duplicatePolicy: v.optional(v.union(v.literal('update'), v.literal('create'))),
  totalRows: v.number(),
  // Rows the SPA could not build; they are in error before any batch runs.
  invalidRows: v.number(),
  batchSize: v.number(),
  // The next batch to process; batches before it are committed.
  nextBatch: v.number(),
  counts: importCountsValidator,
  // The dry run's counts, kept beside the run's.
  simulated: v.optional(importCountsValidator),
  startedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
  updatedAt: v.number(),
  createdBy: v.id('users'),
});
export type ImportJob = Infer<typeof importJobValidator>;

/** What became of one row: the dry run's verdict, then the run's. */
export const importRowOutcomeValidator = v.union(
  // Dry run.
  v.literal('create'),
  v.literal('update'),
  v.literal('duplicate'),
  // Run.
  v.literal('created'),
  v.literal('updated'),
  // Either.
  v.literal('error'),
);
export type ImportRowOutcome = Infer<typeof importRowOutcomeValidator>;

const companyHintValidator = v.object({
  name: v.optional(v.string()),
  country: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  domain: v.optional(v.string()),
});

/** A contact row as the SPA builds it from the mapped columns; consent is never importable. */
export const leadImportRowValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(addressValidator),
  comment: v.optional(v.string()),
  ownerIds: v.optional(v.array(v.id('users'))),
  isRedFlagged: v.optional(v.boolean()),
  lifecycleStage: v.optional(v.string()),
  company: v.optional(companyHintValidator),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type LeadImportRow = Infer<typeof leadImportRowValidator>;

export const companyImportRowValidator = v.object({
  name: v.string(),
  country: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  domain: v.optional(v.string()),
  website: v.optional(v.string()),
  sector: v.optional(v.string()),
  headcount: v.optional(v.number()),
  address: v.optional(addressValidator),
  ownerIds: v.optional(v.array(v.id('users'))),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type CompanyImportRow = Infer<typeof companyImportRowValidator>;

export const dealImportRowValidator = v.object({
  title: v.string(),
  amount: v.optional(v.number()),
  currency: v.optional(v.string()),
  // 'YYYY-MM-DD'.
  expectedCloseDate: v.optional(v.string()),
  // Resolved server-side: a pipeline by name, a stage by label or key.
  pipeline: v.optional(v.string()),
  stage: v.optional(v.string()),
  // The contact the deal belongs to, by email.
  contactEmail: v.optional(v.string()),
  ownerIds: v.optional(v.array(v.id('users'))),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type DealImportRow = Infer<typeof dealImportRowValidator>;

export const activityImportRowValidator = v.object({
  type: activityTypeValidator,
  title: v.string(),
  description: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  status: v.optional(activityStatusValidator),
  contactEmail: v.optional(v.string()),
  // The company by name, for an activity without a contact.
  companyName: v.optional(v.string()),
  ownerId: v.optional(v.id('users')),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type ActivityImportRow = Infer<typeof activityImportRowValidator>;

export const importRowDataValidator = v.union(
  leadImportRowValidator,
  companyImportRowValidator,
  dealImportRowValidator,
  activityImportRowValidator,
);
export type ImportRowData = Infer<typeof importRowDataValidator>;

/** One row of a job: the source cells, the mapped data, and what the dry run then the run made of it. */
export const importRowValidator = v.object({
  jobId: v.id('importJobs'),
  index: v.number(),
  // Line in the source file, for the report.
  line: v.number(),
  raw: v.array(v.string()),
  // Absent when the SPA could not build the row: the error says why.
  data: v.optional(importRowDataValidator),
  outcome: v.optional(importRowOutcomeValidator),
  error: v.optional(v.string()),
  // The record a dry run matched (an update, or a probable duplicate), then the record the run wrote.
  matchId: v.optional(v.string()),
  matchLabel: v.optional(v.string()),
  reasons: v.optional(v.array(v.string())),
});
export type ImportRow = Infer<typeof importRowValidator>;

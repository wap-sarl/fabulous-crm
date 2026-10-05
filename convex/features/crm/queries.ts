// The paths of before the split into leads, leadLists, campaigns and consent, kept for one release.
export {
  listLeadsPaginated,
  searchLeads,
  getLead,
  getLeadDetail,
  listLeadNotes,
  countLeadsByLifecycleStage,
  listLifecycleHistory,
} from '../leads/queries';
export { listLeadLists, getListLimits } from '../leadLists/queries';
export {
  listCampaigns,
  getCampaign,
  listCampaignEvents,
  getCampaignSendPreview,
} from '../campaigns/queries';
export { getConsentByToken } from '../consent/queries';

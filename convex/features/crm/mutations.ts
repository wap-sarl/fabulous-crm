// The paths of before the split into leads, leadLists, campaigns and consent, kept for one release.
export { createCampaign, retryCampaignSend, resendAllCampaignSends } from '../campaigns/mutations';
export {
  createLead,
  updateLead,
  deleteLead,
  deleteLeads,
  importLeads,
  createNote,
  updateNote,
  setNotePinned,
  deleteNote,
} from '../leads/mutations';
export {
  createLeadList,
  updateLeadList,
  recalcLeadList,
  deleteLeadList,
} from '../leadLists/mutations';
export { updateConsentByToken } from '../consent/mutations';

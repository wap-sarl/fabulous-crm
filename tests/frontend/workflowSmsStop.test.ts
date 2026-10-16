import { describe, expect, test } from 'bun:test';
import { SMS_STOP_LINE } from '../../src/features/campaigns/lib/marketingCompliance';
import { draftToPayload } from '../../src/features/workflows/types';
import type { WorkflowDraft } from '../../src/features/workflows/types';

const draft: WorkflowDraft = {
  name: 'Relance',
  description: '',
  trigger: { type: 'lead_created' },
  enrollmentCriteria: undefined,
  allowReEnrollment: false,
  nodes: {
    n1: { id: 'n1', type: 'send_sms', smsBody: 'Bonjour {{ params.firstName }}' },
    n2: { id: 'n2', type: 'send_email', subject: 'Hi', htmlBody: '<p>x</p>' },
  },
  startNodeId: 'n1',
};

describe('a workflow SMS step', () => {
  test('leaves with the STOP line, once, the e-mail steps untouched', () => {
    const payload = draftToPayload(draft, { type: 'lead_created' });
    const sms = payload.nodes.find((n) => n.type === 'send_sms');
    expect(sms && 'smsBody' in sms ? sms.smsBody : null).toBe(
      `Bonjour {{ params.firstName }}\n\n${SMS_STOP_LINE}`,
    );
    const again = draftToPayload(
      { ...draft, nodes: { ...draft.nodes, n1: sms as (typeof draft.nodes)['n1'] } },
      { type: 'lead_created' },
    );
    const twice = again.nodes.find((n) => n.type === 'send_sms');
    expect(twice && 'smsBody' in twice ? twice.smsBody : null).toBe(
      `Bonjour {{ params.firstName }}\n\n${SMS_STOP_LINE}`,
    );
    expect(payload.nodes.find((n) => n.type === 'send_email')).toMatchObject({
      htmlBody: '<p>x</p>',
    });
  });
});

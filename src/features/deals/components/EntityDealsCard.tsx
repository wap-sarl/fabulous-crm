import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { Button, Card, Spinner, StatusBadge } from '@crm/design-system';
import { ChevronRight, Handshake, Plus } from 'lucide-react';
import { DEAL_STATUS_TONE, formatMoney } from '../../../lib/constants';
import { DealFormDialog } from './DealFormDialog';

interface EntityDealsCardProps {
  leadId: Id<'leads'>;
  leadName: string;
}

/** "Transactions" card of a lead or company page: its deals + a create shortcut. */
export function EntityDealsCard({ leadId, leadName }: EntityDealsCardProps) {
  const navigate = useNavigate();
  const deals = useAuthQuery(api.features.deals.queries.listDealsForEntity, { leadId });
  const [formOpen, setFormOpen] = useState(false);
  return (
    <Card className="p-5" data-testid="entity-deals-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-ink">Transactions</h2>
        <Button variant="ghost" size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="size-4" />
          Nouvelle transaction
        </Button>
      </div>
      {deals === undefined ? (
        <Spinner size="sm" />
      ) : deals.length === 0 ? (
        <p className="text-sm text-faint">Aucune transaction.</p>
      ) : (
        <ul className="flex flex-col">
          {deals.map((deal) => (
            <li key={deal._id}>
              <button
                type="button"
                onClick={() => navigate(`/deals/${deal._id}`)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[#F7F8FA]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#E3F6EC] text-[#0C8A43]">
                  <Handshake className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {deal.title}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {formatMoney(deal.amount, deal.currency)}
                  </span>
                </span>
                <StatusBadge tone={DEAL_STATUS_TONE[deal.status]}>{deal.stageLabel}</StatusBadge>
                <ChevronRight className="size-4 shrink-0 text-[#C8CCD4]" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaults={{ leadId, leadName }}
        onCreated={(id) => navigate(`/deals/${id}`)}
      />
    </Card>
  );
}

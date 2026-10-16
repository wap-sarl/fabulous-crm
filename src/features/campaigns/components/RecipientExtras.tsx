import { useMemo } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { HelperText, Input, Label, MultiSelect } from '@crm/design-system';

/** The recipients narrowed down beyond the filter: campaigns whose recipients are left out, and a random share of the matches. */
export function RecipientExtras({
  excludeCampaignIds,
  onExcludeChange,
  sampleSize,
  onSampleSizeChange,
}: {
  excludeCampaignIds: Id<'campaigns'>[];
  onExcludeChange: (ids: Id<'campaigns'>[]) => void;
  sampleSize: string;
  onSampleSizeChange: (value: string) => void;
}) {
  const choices = useAuthQuery(api.features.campaigns.queries.listCampaignChoices, {});
  const items = useMemo(
    () => (choices ?? []).map((c) => ({ value: c._id as string, label: c.name })),
    [choices],
  );
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="w-full space-y-1 sm:max-w-sm">
        <Label>Exclure les destinataires des campagnes</Label>
        <MultiSelect
          items={items}
          value={excludeCampaignIds}
          onValueChange={(ids) => onExcludeChange(ids as Id<'campaigns'>[])}
          placeholder="Aucune"
          className="w-full"
        />
        <HelperText>Les contacts déjà destinataires de ces campagnes sont retirés.</HelperText>
      </div>
      <div className="w-full space-y-1 sm:max-w-[12rem]">
        <Label htmlFor="campaign-sample">Échantillon aléatoire</Label>
        <Input
          id="campaign-sample"
          type="number"
          min={1}
          value={sampleSize}
          onChange={(e) => onSampleSizeChange(e.target.value)}
          placeholder="Tous"
        />
        <HelperText>Vide : tous les contacts correspondants.</HelperText>
      </div>
    </div>
  );
}

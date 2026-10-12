import { useState } from 'react';
import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from '@crm/design-system';
import { CONSENT_CHANNELS } from '../../../lib/constants';
import { LEGAL_BASIS_LABEL, LEGAL_BASIS_WORDING } from '../lib/constants';
import { subscriptionErrorMessage } from '../lib/errors';
import { type SubscriptionTypeForm, subscriptionTypeFormSchema } from '../lib/form';
import type { SubscriptionTypeRow } from '../types';

type FieldErrors = Partial<Record<keyof SubscriptionTypeForm, string>>;

const FIELD_ERROR: Record<string, string> = {
  name: 'Le nom est requis (80 caractères au plus).',
  description: 'La description dépasse 500 caractères.',
};

/** Create or rename a type; its channel and legal basis are chosen once, the consents collected under them depend on it. */
export function SubscriptionTypeDialog({
  type,
  onClose,
}: {
  type: SubscriptionTypeRow | null;
  onClose: () => void;
}) {
  const createType = useAuthMutation(api.features.subscriptions.mutations.createSubscriptionType);
  const updateType = useAuthMutation(api.features.subscriptions.mutations.updateSubscriptionType);
  const [form, setForm] = useState<SubscriptionTypeForm>({
    name: type?.name ?? '',
    description: type?.description ?? '',
    channel: type?.channel ?? 'email',
    legalBasis: type?.legalBasis ?? 'consent',
    active: type?.active ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SubscriptionTypeForm>(key: K, value: SubscriptionTypeForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    const parsed = subscriptionTypeFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key as keyof SubscriptionTypeForm] = FIELD_ERROR[key] ?? issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { name, description, active } = parsed.data;
      if (type) {
        await updateType({ typeId: type._id, name, description, active });
        toast.success('Abonnement mis à jour.');
      } else {
        await createType({ ...parsed.data, description: description || undefined });
        toast.success('Abonnement créé.');
      }
      onClose();
    } catch (error) {
      toast.error(subscriptionErrorMessage(error, 'Échec de l’enregistrement.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type ? 'Modifier l’abonnement' : 'Nouvel abonnement'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="subscription-name">Nom</Label>
            <Input
              id="subscription-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Newsletter"
              aria-invalid={!!errors.name}
            />
            {errors.name && <HelperText className="text-destructive">{errors.name}</HelperText>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subscription-description">Description</Label>
            <Textarea
              id="subscription-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Ce que la personne recevra, et à quel rythme."
              rows={2}
              aria-invalid={!!errors.description}
            />
            <HelperText className={errors.description ? 'text-destructive' : undefined}>
              {errors.description ?? 'Montrée sur le centre de préférences.'}
            </HelperText>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Canal</Label>
              <Select
                value={form.channel}
                onValueChange={(v) => set('channel', v as SubscriptionTypeForm['channel'])}
                disabled={!!type}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSENT_CHANNELS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Base légale</Label>
              <Select
                value={form.legalBasis}
                onValueChange={(v) => set('legalBasis', v as SubscriptionTypeForm['legalBasis'])}
                disabled={!!type}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['consent', 'legitimate_interest'] as const).map((basis) => (
                    <SelectItem key={basis} value={basis}>
                      {LEGAL_BASIS_LABEL[basis]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <HelperText>
            {LEGAL_BASIS_WORDING[form.legalBasis]}
            {type
              ? ' Le canal et la base légale ne changent plus : les consentements recueillis en dépendent.'
              : ' Dans les deux cas le consentement au canal est requis ; un abonnement « consentement » attend en plus le choix de la personne, un abonnement « intérêt légitime » est actif jusqu’à ce qu’elle s’y oppose.'}
          </HelperText>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Actif (proposé sur le centre de préférences et aux campagnes)</span>
            <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} onClick={save}>
            {type ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FunnelBar,
  IconButton,
  InitialsAvatar,
  Input,
  KeyValueList,
  KeyValueRow,
  Label,
  OtpInput,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sparkline,
  StatCard,
  StatusBadge,
  Switch,
  Textarea,
  TimeSeriesChart,
  toast,
} from '@crm/design-system';
import { Eye, Pencil, Send } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { CAMPAIGN_STATUSES, LEAD_STATUSES, SEND_STATUSES } from '../../lib/constants';

const ACCENT_SWATCHES: { varName: string; color: string }[] = [
  { varName: '--primary-soft', color: '#EEEDFE' },
  { varName: '--primary', color: '#5B50F5' },
  { varName: '--primary-strong', color: '#4B41E0' },
];

const NEUTRAL_RAMP = ['#16181D', '#5B6270', '#98A0AD', '#EAECF0', '#F6F7F9'];

const TYPE_SPECIMENS: { caption: string; className: string; text: string }[] = [
  {
    caption: 'Display / 23 / 700',
    className: 'text-[23px] font-bold tracking-[-0.02em] text-ink',
    text: 'Développez chaque relation',
  },
  {
    caption: 'Titre / 16 / 700',
    className: 'text-base font-bold text-ink',
    text: 'Campagne de relance printemps',
  },
  {
    caption: 'Corps / 14 / 400',
    className: 'text-sm text-body',
    text: 'Le lead a été contacté par e-mail et attend une réponse de votre équipe.',
  },
  {
    caption: 'Petit / 12.5 / 500',
    className: 'text-[12.5px] font-medium text-faint',
    text: 'Dernière activité il y a 2 heures',
  },
  {
    caption: 'Mono / 15 / 600',
    className: 'font-mono text-[15px] font-semibold text-ink',
    text: '42,3 % · 4 820 · +33 6 12 34 56 78',
  },
];

const AVATAR_NAMES = ['Camille Roux', 'Julien Bernard', 'Sophie Martin', 'Louis Petit'];

const SPARKLINE_POINTS = [12, 18, 14, 26, 22, 31, 28, 38, 35, 44];

const TIME_SERIES = [
  { label: '1 juil.', value: 120 },
  { label: '2 juil.', value: 185 },
  { label: '3 juil.', value: 150 },
  { label: '4 juil.', value: 240 },
  { label: '5 juil.', value: 210 },
  { label: '6 juil.', value: 305 },
  { label: '7 juil.', value: 280 },
  { label: '8 juil.', value: 342 },
];

const TAGS = ['Pharmacien', 'Newsletter', 'Import CSV', 'Prioritaire'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-[13px] font-bold uppercase tracking-wide text-faint">{title}</h2>
      {children}
    </Card>
  );
}

function Swatch({ color, label, className }: { color: string; label: string; className?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={className ?? 'h-14 w-[120px] rounded-lg border'}
        style={{ backgroundColor: color }}
      />
      <span className="font-mono text-[11px] text-soft">{label}</span>
    </div>
  );
}

function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function DesignSystemPage() {
  usePageTitle('Design system');

  const [selectValue, setSelectValue] = useState('email');
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(true);
  const [date, setDate] = useState('2026-07-02');
  const [otp, setOtp] = useState('4821');
  const [channel, setChannel] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 px-5 pb-8 sm:px-7">
        <PageHeader title="Design system" subtitle="Fondations et composants du CRM" />
        <Section title="Couleurs">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-4">
              {ACCENT_SWATCHES.map((s) => (
                <Swatch key={s.varName} color={s.color} label={s.varName} />
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              {NEUTRAL_RAMP.map((hex) => (
                <Swatch key={hex} color={hex} label={hex} className="h-14 w-24 rounded-lg border" />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {LEAD_STATUSES.map((s) => (
                <StatusBadge key={s.value} tone={s.tone}>
                  {s.label}
                </StatusBadge>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Typographie — Onest / JetBrains Mono">
          <div className="flex flex-col gap-4">
            {TYPE_SPECIMENS.map((spec) => (
              <div
                key={spec.caption}
                className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <span className="w-40 shrink-0 font-mono text-[11px] text-faint">
                  {spec.caption}
                </span>
                <span className={spec.className}>{spec.text}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Boutons">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <Send />
                Action principale
              </Button>
              <Button variant="outline">Secondaire</Button>
              <Button variant="ghost">Discret</Button>
              <Button variant="fill" color="destructive">
                Danger
              </Button>
              <Button disabled>Désactivé</Button>
              <Button loading>Envoi en cours</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <IconButton aria-label="Modifier">
                <Pencil />
              </IconButton>
              <span className="text-[12.5px] text-faint">IconButton — « Modifier »</span>
            </div>
          </div>
        </Section>

        <Section title="Champs">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Champ vide" htmlFor="ds-input-empty">
              <Input id="ds-input-empty" placeholder="Rechercher un lead" />
            </Field>
            <Field label="Champ rempli" htmlFor="ds-input-filled">
              <Input id="ds-input-filled" defaultValue="Camille Roux" />
            </Field>
            <Field label="Canal préféré">
              <Select value={selectValue} onValueChange={setSelectValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="postal">Courrier postal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Commentaire" htmlFor="ds-textarea">
              <Textarea id="ds-textarea" placeholder="Ajouter une note sur ce lead…" rows={3} />
            </Field>
            <Field label="Date de relance">
              <DatePicker value={date} onValueChange={setDate} />
            </Field>
            <Field label="Code de vérification">
              <OtpInput
                length={4}
                numeric
                value={otp}
                onChange={setOtp}
                className="justify-start"
              />
            </Field>
            <div className="flex items-center gap-2.5">
              <Checkbox
                id="ds-checkbox"
                checked={checked}
                onCheckedChange={(v) => setChecked(v === true)}
              />
              <Label htmlFor="ds-checkbox">Recevoir la newsletter</Label>
            </div>
            <div className="flex items-center gap-2.5">
              <Switch id="ds-switch" checked={switched} onCheckedChange={setSwitched} />
              <Label htmlFor="ds-switch">Notifications activées</Label>
            </div>
          </div>
        </Section>

        <Section title="Segmented & tags">
          <div className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Filtrer par canal"
              items={[
                { value: 'all', label: 'Tous', count: 128 },
                { value: 'email', label: 'E-mail', count: 96 },
                { value: 'sms', label: 'SMS', count: 32 },
              ]}
              value={channel}
              onChange={setChannel}
            />
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-[#F2F3F5] px-2 py-0.5 text-[11.5px] font-medium text-soft"
                >
                  {tag}
                </span>
              ))}
              <span className="rounded-md bg-[#F2F3F5] px-2 py-0.5 text-[11.5px] font-medium text-soft">
                +2
              </span>
            </div>
          </div>
        </Section>

        <Section title="Avatars">
          <div className="flex flex-wrap items-center gap-3">
            <InitialsAvatar name="Marie Dupont" size={44} />
            {AVATAR_NAMES.map((name) => (
              <InitialsAvatar key={name} name={name} size={36} />
            ))}
          </div>
        </Section>

        <Section title="Badges de statut">
          <div className="flex flex-col gap-3">
            {(
              [
                { caption: 'Leads', statuses: LEAD_STATUSES },
                { caption: 'Campagnes', statuses: CAMPAIGN_STATUSES },
                { caption: 'Envois', statuses: SEND_STATUSES },
              ] as const
            ).map((row) => (
              <div
                key={row.caption}
                className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-6"
              >
                <span className="w-24 shrink-0 text-[12.5px] font-medium text-faint">
                  {row.caption}
                </span>
                <div className="flex flex-wrap gap-2">
                  {row.statuses.map((s) => (
                    <StatusBadge key={s.value} tone={s.tone}>
                      {s.label}
                    </StatusBadge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="StatCard">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Taux d'envoi"
              value="42,3%"
              sub="2 015 envois"
              icon={<Eye />}
              iconBg="#E7F0FF"
              iconColor="#1D6BE0"
            />
            <StatCard
              label="Leads convertis"
              value="184"
              sub="+12 cette semaine"
              icon={<Send />}
              iconBg="#E3F6EC"
              iconColor="#0C8A43"
            />
          </div>
        </Section>

        <Section title="Liste clé/valeur">
          <KeyValueList>
            <KeyValueRow label="Source">Import CSV</KeyValueRow>
            <KeyValueRow label="Assigné à">Camille Roux</KeyValueRow>
            <KeyValueRow label="Créé le" mono>
              02/07/2026 · 09:41
            </KeyValueRow>
          </KeyValueList>
        </Section>

        <Section title="Entonnoir">
          <div className="flex flex-col gap-4">
            <FunnelBar label="Leads contactés" count={4820} percent={100} color="#6A4BF0" />
            <FunnelBar label="Intéressés" count={1930} percent={40} color="#4B41E0" />
            <FunnelBar label="Convertis" count={412} percent={8.5} color="#12A150" />
          </div>
        </Section>

        <Section title="Graphiques">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <Sparkline points={SPARKLINE_POINTS} />
              <span className="text-[12.5px] text-faint">Sparkline — tendance sur 10 jours</span>
            </div>
            <TimeSeriesChart series={TIME_SERIES} />
          </div>
        </Section>

        <Section title="Dialogues & toasts">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              Ouvrir le dialogue
            </Button>
            <Button variant="outline" onClick={() => toast.success('Enregistré.')}>
              Afficher un toast
            </Button>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Exemple de dialogue</DialogTitle>
                <DialogDescription>
                  Les dialogues confirment une action ou recueillent une saisie courte.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-body">
                Ce contenu est un exemple statique du design system Cadence.
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  Annuler
                </Button>
                <Button onClick={() => setDialogOpen(false)}>Confirmer</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>
      </div>
    </div>
  );
}

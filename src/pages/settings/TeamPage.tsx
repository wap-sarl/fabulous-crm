import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@crm/design-system';
import { Mail, RotateCw, Trash2, UserPlus } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { TeamsSection } from '../../features/teams/components/TeamsSection';

const INVITE_ERRORS: Record<string, string> = {
  invalid_email: 'Adresse e-mail invalide.',
  already_member: 'Cette personne est déjà membre.',
  already_invited: 'Une invitation est déjà en attente pour cette adresse.',
};

type Role = 'member' | 'manager' | 'admin';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrateur',
  manager: 'Manager',
  member: 'Membre',
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role as Role] ?? 'Membre';
}

function TeamManager() {
  const employees = useQuery(api.features.users.queries.listEmployees, {});
  const invitations = useQuery(api.features.invitations.queries.listInvitations, {});
  const createInvitation = useMutation(api.features.invitations.mutations.createInvitation);
  const revokeInvitation = useMutation(api.features.invitations.mutations.revokeInvitation);
  const resendInvitation = useMutation(api.features.invitations.mutations.resendInvitation);
  const setEmployeeRole = useMutation(api.features.users.mutations.setEmployeeRole);
  const { user: me } = useAuth();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await createInvitation({ email: email.trim().toLowerCase(), role });
      setSuccess(`Invitation envoyée à ${email.trim().toLowerCase()}.`);
      setEmail('');
      setRole('member');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const key = Object.keys(INVITE_ERRORS).find((k) => message.includes(k));
      setError(key ? INVITE_ERRORS[key] : "L'invitation a échoué. Veuillez réessayer.");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (invitationId: Id<'invitations'>) => {
    try {
      await revokeInvitation({ invitationId });
    } catch {
      setError('La révocation a échoué. Veuillez réessayer.');
    }
  };

  const handleResend = async (invitationId: Id<'invitations'>, inviteEmail: string) => {
    setError(null);
    setSuccess(null);
    try {
      await resendInvitation({ invitationId });
      setSuccess(`Invitation renvoyée à ${inviteEmail}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('email_not_configured')
          ? "Aucun fournisseur d'e-mail n'est configuré. Configurez-le dans Paramètres → E-mail."
          : 'Le renvoi a échoué. Veuillez réessayer.',
      );
    }
  };

  return (
    <div className="space-y-8">
      {/* Invite form */}
      <Card className="p-6">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-ink">
          <UserPlus className="size-4" aria-hidden="true" />
          Inviter un membre
        </h2>
        <form
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
          onSubmit={handleInvite}
          noValidate
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="invite-email" className="text-[12.5px] font-semibold text-soft">
              Adresse e-mail
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="collegue@email.fr"
              autoComplete="off"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              invalid={!!error}
            />
          </div>
          <div className="space-y-2 sm:w-48">
            <Label className="text-[12.5px] font-semibold text-soft">Rôle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Membre</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Administrateur</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" loading={busy} disabled={!email.trim()}>
            Inviter
          </Button>
        </form>
        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="mt-3 text-sm text-success" role="status">
            {success}
          </p>
        )}
      </Card>

      {/* Pending invitations */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Invitations en attente</h2>
        {invitations === undefined ? (
          <Spinner size="sm" />
        ) : invitations.length === 0 ? (
          <p className="text-sm text-soft">Aucune invitation en attente.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {invitations.map((invite) => (
              <li key={invite._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Mail className="size-4 shrink-0 text-soft" aria-hidden="true" />
                  <span className="truncate text-sm text-ink">{invite.email}</span>
                  <Badge variant="secondary">{roleLabel(invite.role)}</Badge>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleResend(invite._id, invite.email)}
                    aria-label={`Renvoyer l'invitation à ${invite.email}`}
                  >
                    <RotateCw className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(invite._id)}
                    aria-label={`Révoquer l'invitation de ${invite.email}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Current members */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Membres</h2>
        {employees === undefined ? (
          <Spinner size="sm" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {employees.map((member) => (
              <li key={member._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-ink">
                    {member.firstName} {member.lastName}
                  </span>
                  <span className="truncate text-xs text-soft">{member.email}</span>
                </div>
                {member._id === me?._id ? (
                  <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
                    {roleLabel(member.role ?? 'member')}
                  </Badge>
                ) : (
                  <Select
                    value={member.role ?? 'member'}
                    onValueChange={async (v) => {
                      try {
                        await setEmployeeRole({ userId: member._id, role: v as Role });
                      } catch {
                        setError('Le changement de rôle a échoué.');
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 w-40" aria-label={`Rôle de ${member.firstName}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <TeamsSection />
    </div>
  );
}

/** Admin-only team management: members + pending invitations + invite form. */
export function TeamPage() {
  usePageTitle('Équipe');
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Équipe" subtitle="Gérez les membres et les invitations" />
      <div className="mt-6">
        {user?.role === 'admin' ? (
          <TeamManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}

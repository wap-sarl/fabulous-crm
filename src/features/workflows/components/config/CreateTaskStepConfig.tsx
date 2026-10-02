import {
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { Id, WorkflowNode } from '@crm/lib/backend';
import { ACTIVITY_TYPES } from '../../../../lib/constants';
import { useEmployees } from '../../../../lib/hooks/useEmployees';
import { useTeams } from '../../../../lib/hooks/useTeams';

type CreateTaskNode = Extract<WorkflowNode, { type: 'create_task' }>;

const LEAD_OWNER = '__lead_owner__';
const NO_TEAM = '__no_team__';

export function CreateTaskStepConfig({
  value,
  onChange,
}: {
  value: CreateTaskNode;
  onChange: (next: CreateTaskNode) => void;
}) {
  const { employees } = useEmployees();
  const { teams } = useTeams();
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label>Type</Label>
        <Select
          value={value.activityType ?? 'task'}
          onValueChange={(v) =>
            onChange({ ...value, activityType: v as CreateTaskNode['activityType'] })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_TYPES.filter((t) => t.value !== 'note').map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wf-task-title">Intitulé</Label>
        <Input
          id="wf-task-title"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Rappeler {{ params.firstName }} {{ params.lastName }}"
        />
        <HelperText>Les {'{{ params.x }}'} du lead sont remplacés à la création.</HelperText>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wf-task-description">Description (optionnel)</Label>
        <Input
          id="wf-task-description"
          value={value.description ?? ''}
          onChange={(e) => onChange({ ...value, description: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wf-task-due">Échéance (jours après l’étape)</Label>
        <Input
          id="wf-task-due"
          type="number"
          min={0}
          max={365}
          className="w-32"
          value={value.dueInDays !== undefined ? String(value.dueInDays) : ''}
          onChange={(e) =>
            onChange({
              ...value,
              dueInDays: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
        <HelperText>0 = le jour même ; vide = tâche sans date.</HelperText>
      </div>
      <div className="space-y-1.5">
        <Label>Propriétaire</Label>
        <Select
          value={(value.ownerId as string | undefined) ?? LEAD_OWNER}
          onValueChange={(v) =>
            onChange({ ...value, ownerId: v === LEAD_OWNER ? undefined : (v as Id<'users'>) })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LEAD_OWNER}>
              Responsable du lead (sinon l’auteur du workflow)
            </SelectItem>
            {employees.map((e) => (
              <SelectItem key={e._id} value={e._id}>
                {e.firstName} {e.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Équipe</Label>
        <Select
          value={(value.teamId as string | undefined) ?? NO_TEAM}
          onValueChange={(v) =>
            onChange({ ...value, teamId: v === NO_TEAM ? undefined : (v as Id<'teams'>) })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TEAM}>Aucune équipe</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t._id} value={t._id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HelperText>Une tâche confiée à une équipe est visible par tous ses membres.</HelperText>
      </div>
    </div>
  );
}

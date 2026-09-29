import { useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { Button, Card, Input, Label, toast } from '@crm/design-system';
import { useScoringActions } from '../hooks/useScoringActions';

/** What-if card: « combien de leads seraient à N points ou plus ? » */
export function SimulationCard() {
  const state = useAuthQuery(api.features.scoring.queries.getScoringState, {});
  const { startScoreSimulation } = useScoringActions();
  const [threshold, setThreshold] = useState('50');

  const sim = state?.simulation ?? null;
  const running = sim !== null && sim.finishedAt === undefined;

  const run = async () => {
    try {
      await startScoreSimulation({ threshold: Number(threshold) });
    } catch {
      toast.error('Seuil invalide (entier entre 0 et 100).');
    }
  };

  return (
    <Card className="mt-6 p-5">
      <h2 className="text-[15px] font-bold text-ink">Simulation</h2>
      <p className="mt-1 text-xs text-soft">
        Compte les leads dont le score atteindrait le seuil avec les règles actuelles (calcul en
        arrière-plan sur toute la base).
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Seuil</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-24"
          />
        </div>
        <Button variant="outline" onClick={run} loading={running}>
          Simuler
        </Button>
        {sim && (
          <p className="pb-2 text-sm text-body" role="status">
            {running
              ? `Calcul en cours… ${sim.processed} lead(s) analysés`
              : `${sim.matched} lead(s) à ${sim.threshold} points ou plus (${sim.processed} analysés).`}
          </p>
        )}
      </div>
    </Card>
  );
}

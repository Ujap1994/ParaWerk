import { useTranslation } from 'react-i18next';
import type { Feature } from '../../../shared/model/feature.ts';
import type { FaceNameRef } from '../../../shared/model/reference.ts';
import { bodiesOf, bodyOfRef, bodyRef, type BodyInfo } from '../bodies.ts';
import * as commands from '../commands.ts';
import { useAppState } from '../state/store.ts';
import { useBodyName } from './FeatureTree.tsx';

/**
 * The feature scope of a feature that adds or cuts material on a part of several bodies: all bodies, or
 * only those ticked (docs/adr/0011-multi-body-parts.md).
 */
export function ScopeField() {
  const { t } = useTranslation();
  const before = useAppState((state) => state.display.before ?? null);
  const scope = useAppState((state) => (state.activeEdit?.draft as { scope?: FaceNameRef[] } | undefined)?.scope) ?? [];
  const bodyName = useBodyName();
  if (!before) return null;
  const bodies = bodiesOf(before);
  if (bodies.length < 2) return null;
  const chosen = new Set(scope.map((ref) => bodyOfRef(before, ref)));
  const refsOf = (list: readonly BodyInfo[]) => list.flatMap((body) => bodyRef(before, body) ?? []);
  const toggle = (body: BodyInfo) => {
    const next = bodies.filter((candidate) => (candidate.index === body.index ? !chosen.has(candidate.index) : chosen.has(candidate.index)));
    // At least one body: none ticked would mean all again.
    if (next.length > 0) commands.updateDraft({ scope: refsOf(next) } as Partial<Feature>);
  };
  return (
    <div className="field scope-field" data-testid="feature-scope">
      <span className="field-label">{t('scope.title')}</span>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={scope.length === 0}
          data-testid="scope-all"
          onChange={(event) => commands.updateDraft({ scope: event.target.checked ? undefined : refsOf(bodies) } as Partial<Feature>)}
        />
        {t('scope.all')}
      </label>
      {scope.length > 0
        ? bodies.map((body) => (
            <label key={body.index} className="checkbox-field scope-body">
              <input type="checkbox" checked={chosen.has(body.index)} data-testid={`scope-body-${body.index}`} onChange={() => toggle(body)} />
              {bodyName(body)}
            </label>
          ))
        : null}
      {scope.length > 0 ? <p className="panel-hint">{t('scope.hint')}</p> : null}
    </div>
  );
}

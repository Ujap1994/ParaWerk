import { useTranslation } from 'react-i18next';
import type { Variable, VariablesFeature } from '../../../shared/model/feature.ts';
import * as commands from '../commands.ts';
import { isVariableName } from '../expression.ts';
import { formatNumber } from '../format.ts';
import { useAppState } from '../state/store.ts';
import { evaluateVariables } from '../variables.ts';
import { TrashIcon } from './icons.tsx';

/** Why a variable row cannot be applied, or null. */
export function variableProblem(variables: readonly Variable[], index: number): 'name' | 'duplicate' | null {
  const variable = variables[index];
  if (!variable || !isVariableName(variable.name)) return 'name';
  const lower = variable.name.toLowerCase();
  return variables.some((other, i) => i !== index && other.name.toLowerCase() === lower) ? 'duplicate' : null;
}

/** Whether the variables can be applied: valid, unique names and a value for every variable. */
export function variablesValid(variables: readonly Variable[]): boolean {
  const { errors } = evaluateVariables(variables);
  return errors.size === 0 && variables.every((variable, i) => variableProblem(variables, i) === null && variable.expression.trim().length > 0);
}

/** Table of the part's variables: name, expression and current value, with problems explained per row. */
export function VariablesEditor({ draft }: { draft: VariablesFeature }) {
  const { t } = useTranslation();
  const language = useAppState((state) => state.language);
  const { values, errors } = evaluateVariables(draft.variables);
  const update = (index: number, patch: Partial<Variable>) =>
    commands.updateDraft({ variables: draft.variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable)) } as Partial<VariablesFeature>);
  const remove = (index: number) => commands.updateDraft({ variables: draft.variables.filter((_, i) => i !== index) } as Partial<VariablesFeature>);
  const add = () => {
    const used = new Set(draft.variables.map((variable) => variable.name.toLowerCase()));
    let n = draft.variables.length + 1;
    while (used.has(`d${n}`)) n++;
    commands.updateDraft({ variables: [...draft.variables, { name: `d${n}`, expression: '10' }] } as Partial<VariablesFeature>);
  };

  return (
    <section className="panel-section" data-testid="variables-editor">
      <p className="panel-hint is-flush">{t('variables.hint')}</p>
      {draft.variables.length > 0 ? (
        <div className="variables-table" role="table" aria-label={t('variables.title')}>
          <div className="variables-row is-header" role="row">
            <span role="columnheader">{t('variables.name')}</span>
            <span role="columnheader">{t('variables.expression')}</span>
            <span role="columnheader">{t('variables.value')}</span>
            <span />
          </div>
          {draft.variables.map((variable, i) => {
            const lower = variable.name.toLowerCase();
            const problem = variableProblem(draft.variables, i);
            const error = errors.get(lower);
            const message = problem ? t(`variables.problems.${problem}`) : error ? t(`variables.errors.${error}`) : null;
            const value = values.get(lower);
            return (
              <div key={i} className={`variables-row${message ? ' is-invalid' : ''}`} role="row" data-variable={variable.name}>
                <input
                  className="field-input"
                  aria-label={t('variables.name')}
                  value={variable.name}
                  spellCheck={false}
                  autoComplete="off"
                  data-testid="variable-name"
                  onChange={(event) => update(i, { name: event.target.value.trim() })}
                />
                <input
                  className="field-input"
                  aria-label={t('variables.expression')}
                  value={variable.expression}
                  title={variable.expression}
                  spellCheck={false}
                  autoComplete="off"
                  data-testid="variable-expression"
                  onChange={(event) => update(i, { expression: event.target.value })}
                />
                <span className="variables-value" data-testid="variable-value">
                  {value !== undefined && !problem ? formatNumber(value, language, 4) : '–'}
                </span>
                <button type="button" className="icon-button is-danger" title={t('variables.remove')} aria-label={t('variables.remove')} onClick={() => remove(i)}>
                  <TrashIcon />
                </button>
                {message ? <span className="field-error variables-error">{message}</span> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="panel-hint is-flush">{t('variables.empty')}</p>
      )}
      <button type="button" className="text-button" data-testid="variable-add" onClick={add}>
        {t('variables.add')}
      </button>
    </section>
  );
}

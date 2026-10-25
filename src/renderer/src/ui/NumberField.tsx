import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { evaluate, variableNames } from '../expression.ts';
import { formatNumber } from '../format.ts';
import { useAppState } from '../state/store.ts';
import { variableValues } from '../variables.ts';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange(value: number): void;
  /** Allow zero and negative values (coordinates). */
  signed?: boolean;
  unit?: string;
  step?: number;
  testId?: string;
  /** The value as an equation over the part's variables, if it is given as one. */
  expression?: string;
  /** Receives the typed text when it uses variables, undefined when it is a plain value. Without it, variables are not offered. */
  onExpression?(expression: string | undefined): void;
}

/**
 * Numeric input with live preview: every valid keystroke updates the model,
 * arrow keys step the value (Shift: ×10), both "," and "." are accepted.
 */
export function NumberField({ label, value, onChange, signed = false, unit = 'mm', step = 1, testId, expression, onExpression }: NumberFieldProps) {
  const { t } = useTranslation();
  const language = useAppState((state) => state.language);
  const features = useAppState((state) => state.history.features);
  const variables = useMemo(() => (onExpression ? variableValues(features) : new Map<string, number>()), [features, onExpression]);
  const id = useId();
  // Text typed by the user while the field has focus; otherwise the equation or the formatted value is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = expression ?? formatNumber(value, language);
  const text = draft ?? shown;
  const parsed = evaluate(text, variables);
  const valid = parsed !== null && (signed || parsed > 0);
  /** Applies typed text: its value, and the text itself if it uses variables. */
  const apply = (typed: string) => {
    const next = evaluate(typed, variables);
    if (next === null || !(signed || next > 0)) return;
    onChange(next);
    if (!onExpression) return;
    const uses = (variableNames(typed) ?? []).length > 0;
    const nextExpression = uses ? typed.trim() : undefined;
    if (nextExpression !== expression) onExpression(nextExpression);
  };

  const commit = (next: number) => {
    setDraft(formatNumber(next, language));
    onChange(next);
    // Stepping with the arrow keys replaces an equation with a plain value.
    if (expression !== undefined) onExpression?.(undefined);
  };

  return (
    <div className={`field${valid ? '' : ' is-invalid'}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="field-control">
        <input
          id={id}
          className="field-input"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          data-testid={testId}
          aria-invalid={!valid}
          onFocus={(event) => {
            setDraft(shown);
            event.currentTarget.select();
          }}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            setDraft(event.target.value);
            apply(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
            const next = Math.round(((parsed ?? value) + delta) * 1e6) / 1e6;
            if (signed || next > 0) commit(next);
          }}
        />
        <span className="field-unit">{unit}</span>
      </div>
      {valid ? null : <div className="field-error">{t('panel.invalidNumber')}</div>}
      {valid && expression !== undefined && draft === null ? (
        <div className="field-note" data-testid={testId ? `${testId}-value` : undefined}>
          = {formatNumber(value, language)} {unit}
        </div>
      ) : null}
    </div>
  );
}

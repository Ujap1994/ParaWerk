import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { REPOSITORY_URL } from '../../../shared/app-info.ts';
import type { LanguageSetting, NavigationPreset, Projection, ThemeSetting } from '../../../shared/settings.ts';
import * as commands from '../commands.ts';
import { coordinateSystems } from '../references.ts';
import { featureName } from '../state/document.ts';
import { discardRecovery, restoreRecovery } from '../state/recovery.ts';
import { dismissToast, setState, useAppState } from '../state/store.ts';
import { CloseIcon } from './icons.tsx';

function Modal({ open, title, onClose, children, testId }: { open: boolean; title: string; onClose(): void; children: ReactNode; testId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-label={title} data-testid={testId} onClose={onClose} onCancel={onClose}>
      <header className="modal-header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

function Choice<T extends string>({ label, value, options, onChange, name }: { label: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void; name: string }) {
  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            name={name}
            data-value={option.value}
            aria-checked={value === option.value}
            className={`segmented-option${value === option.value ? ' is-selected' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const { t } = useTranslation();
  const open = useAppState((state) => state.dialogs.settings);
  const settings = useAppState((state) => state.settings);
  return (
    <Modal open={open} title={t('settings.title')} onClose={() => commands.closeDialog('settings')} testId="settings-dialog">
      <Choice<LanguageSetting>
        name="language"
        label={t('settings.language')}
        value={settings.language}
        options={[
          { value: 'system', label: t('settings.languageSystem') },
          { value: 'en', label: 'English' },
          { value: 'de', label: 'Deutsch' },
        ]}
        onChange={(language) => void commands.updateSettings({ language })}
      />
      <Choice<ThemeSetting>
        name="theme"
        label={t('settings.theme')}
        value={settings.theme}
        options={[
          { value: 'system', label: t('settings.themeSystem') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
        ]}
        onChange={(theme) => void commands.updateSettings({ theme })}
      />
      <Choice<NavigationPreset>
        name="navigation"
        label={t('settings.navigation')}
        value={settings.navigation}
        options={[
          { value: 'mouse', label: t('settings.navigationMouse') },
          { value: 'trackpad', label: t('settings.navigationTrackpad') },
        ]}
        onChange={(navigation) => void commands.updateSettings({ navigation })}
      />
      <p className="setting-help">{settings.navigation === 'mouse' ? t('settings.navigationMouseHelp') : t('settings.navigationTrackpadHelp')}</p>
      <Choice<Projection>
        name="projection"
        label={t('settings.projection')}
        value={settings.projection}
        options={[
          { value: 'orthographic', label: t('settings.projectionOrthographic') },
          { value: 'perspective', label: t('settings.projectionPerspective') },
        ]}
        onChange={(projection) => void commands.updateSettings({ projection })}
      />
      <label className="setting checkbox-setting">
        <input type="checkbox" checked={settings.showFrameStats} onChange={(event) => void commands.updateSettings({ showFrameStats: event.target.checked })} />
        <span>{t('settings.frameStats')}</span>
      </label>
      <label className="setting checkbox-setting">
        <input
          type="checkbox"
          checked={settings.showSketchRelations}
          onChange={(event) => void commands.updateSettings({ showSketchRelations: event.target.checked })}
        />
        <span>{t('settings.sketchRelations')}</span>
      </label>
      <label className="setting checkbox-setting">
        <input type="checkbox" checked={settings.autoRecover} data-testid="setting-auto-recover" onChange={(event) => void commands.updateSettings({ autoRecover: event.target.checked })} />
        <span>{t('settings.autoRecover')}</span>
      </label>
      <p className="setting-help">{t('settings.autoRecoverHelp')}</p>
    </Modal>
  );
}

export function AboutDialog() {
  const { t } = useTranslation();
  const open = useAppState((state) => state.dialogs.about);
  const info = useAppState((state) => state.appInfo);
  return (
    <Modal open={open} title={t('about.title')} onClose={() => commands.closeDialog('about')} testId="about-dialog">
      <div className="about">
        <img src="./favicon.svg" alt="" width={72} height={72} />
        <div>
          <p className="about-name">ParaWerk</p>
          <p className="about-version">{t('about.version', { version: info?.version ?? '' })}</p>
          <p className="about-tech">
            Electron {info?.electron} · Chromium {info?.chrome} · {info?.platform} {info?.arch}
          </p>
        </div>
      </div>
      <p className="about-warning">{t('about.disclaimer')}</p>
      <p>{t('about.license')}</p>
      <p>{t('about.thirdParty')}</p>
      <button type="button" className="text-button" onClick={() => void window.parawerk.openExternal(REPOSITORY_URL)}>
        {t('about.website')}
      </button>
    </Modal>
  );
}

/** Asks which coordinate system an export is in (only when the part has coordinate systems). */
export function ExportFrameDialog() {
  const { t } = useTranslation();
  const format = useAppState((state) => state.exporting);
  return (
    <Modal open={format !== null} title={t('dialogs.exportFrame.title')} onClose={() => void commands.confirmExport('cancel')} testId="export-frame-dialog">
      {/* Mounted while open, so every export starts from the last choice. */}
      {format ? <ExportFrameChoice /> : null}
    </Modal>
  );
}

function ExportFrameChoice() {
  const { t } = useTranslation();
  const last = useAppState((state) => state.exportFrame);
  const features = useAppState((state) => state.history.features);
  const systemsText = useAppState((state) => JSON.stringify(coordinateSystems(state).map(({ id, index }) => ({ id, index }))));
  const systems = useMemo(() => JSON.parse(systemsText) as { id: string; index: number }[], [systemsText]);
  // The last choice again, while it still exists.
  const [choice, setChoice] = useState(() => (last && systems.some((system) => system.id === last) ? last : ''));
  return (
    <>
      <label className="field">
        <span className="field-label">{t('dialogs.exportFrame.frame')}</span>
        <select className="field-select" value={choice} data-testid="export-frame" onChange={(event) => setChoice(event.target.value)}>
          <option value="">{t('dialogs.exportFrame.modelOrigin')}</option>
          {systems.map((system) => (
            <option key={system.id} value={system.id}>
              {featureName(features, system.index, t)}
            </option>
          ))}
        </select>
      </label>
      <p className="setting-help">{t('dialogs.exportFrame.hint')}</p>
      <div className="modal-actions">
        <button type="button" className="button" onClick={() => void commands.confirmExport('cancel')}>
          {t('dialogs.cancel')}
        </button>
        <button type="button" className="button is-primary" data-testid="export-frame-ok" onClick={() => void commands.confirmExport(choice || null)}>
          {t('dialogs.exportFrame.export')}
        </button>
      </div>
    </>
  );
}

/** Offers the recovery copies of documents whose session ended abnormally (see state/recovery.ts). */
export function RecoveryDialog() {
  const { t } = useTranslation();
  const entries = useAppState((state) => state.recovery);
  const language = useAppState((state) => state.language);
  const time = (iso: string) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return (
    <Modal open={entries.length > 0} title={t('recovery.title')} onClose={() => setState({ recovery: [] })} testId="recovery-dialog">
      <p>{t('recovery.message')}</p>
      <ul className="recovery-list">
        {entries.map((entry) => (
          <li key={entry.session} className="recovery-entry" data-session={entry.session}>
            <div className="recovery-entry-text">
              <span className="recovery-entry-name">{entry.name}</span>
              <span className="recovery-entry-time">{t('recovery.savedAt', { time: time(entry.savedAt) })}</span>
            </div>
            <button type="button" className="button" data-testid="recovery-discard" onClick={() => void discardRecovery(entry)}>
              {t('recovery.discard')}
            </button>
            <button type="button" className="button is-primary" data-testid="recovery-restore" onClick={() => void restoreRecovery(entry)}>
              {t('recovery.restore')}
            </button>
          </li>
        ))}
      </ul>
      <p className="setting-help">{t('recovery.hint')}</p>
      <div className="modal-actions">
        <button type="button" className="button" data-testid="recovery-later" onClick={() => setState({ recovery: [] })}>
          {t('recovery.later')}
        </button>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useAppState((state) => state.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast is-${toast.kind}`} data-testid={`toast-${toast.kind}`}>
          <span>{toast.message}</span>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => dismissToast(toast.id)}>
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

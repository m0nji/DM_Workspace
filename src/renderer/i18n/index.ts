import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import de from './de.json';

export type Locale = 'en' | 'de';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'de'];

/** Resolve an effective locale: explicit setting → OS language → English. */
export function resolveLocale(setting?: string | null): Locale {
  if (setting === 'en' || setting === 'de') return setting;
  const sys = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
  return /^de\b/i.test(sys) ? 'de' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: resolveLocale(), // pre-hydration best guess; App re-syncs after load
  fallbackLng: 'en',
  interpolation: { escapeValue: false } // React already escapes
});

export default i18n;

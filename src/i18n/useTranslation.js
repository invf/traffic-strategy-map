import { useStore } from '../store/useStore';
import translations from './translations';

export function useTranslation() {
  const language = useStore((s) => s.language);
  const dict = translations[language] || translations.en;
  return (key) => dict[key] ?? translations.en[key] ?? key;
}

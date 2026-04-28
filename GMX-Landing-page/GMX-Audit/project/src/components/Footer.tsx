import { Shield } from 'lucide-react';
import type { LocaleCode, LocaleStrings } from '../i18n/locales';

interface FooterProps {
  onNavigate: (page: string) => void;
  locale: LocaleCode;
  strings: LocaleStrings['footer'];
}

export default function Footer({ onNavigate, locale, strings }: FooterProps) {
  return (
    <footer className="bg-[#030810] border-t border-[#1a2f4a] py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-8">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#0ea5e9]" />
            <span className="font-bold text-white text-sm tracking-wider uppercase">GMX Audit Control Center {locale.toUpperCase()}</span>
          </div>
          <p className="text-[#475569] text-sm max-w-md">
            {strings.summary}
          </p>
        </div>

        <div className="border-t border-[#1a2f4a] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[#475569] text-xs">
            &copy; {new Date().getFullYear()} GMX Audit Control Center. {strings.rights}
          </p>
          <div className="flex items-center gap-6">
            <button
              onClick={() => onNavigate('privacy')}
              className="text-[#475569] hover:text-[#94a3b8] text-xs transition-colors"
            >
              {strings.privacy}
            </button>
            <button
              onClick={() => onNavigate('terms')}
              className="text-[#475569] hover:text-[#94a3b8] text-xs transition-colors"
            >
              {strings.terms}
            </button>
            <button
              onClick={() => onNavigate('support')}
              className="text-[#475569] hover:text-[#94a3b8] text-xs transition-colors"
            >
              {strings.support}
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

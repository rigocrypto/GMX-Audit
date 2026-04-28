import { useState } from 'react';
import { Shield, Menu, X } from 'lucide-react';
import type { LocaleCode, LocaleStrings } from '../i18n/locales';

interface NavbarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  locale: LocaleCode;
  strings: LocaleStrings['nav'];
}

export default function Navbar({ currentPage, onNavigate, locale, strings }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { label: strings.services, href: '#services' },
    { label: strings.pricing, href: '#pricing' },
    { label: strings.howItWorks, href: '#how-it-works' },
    { label: strings.faq, href: '#faq' },
    { label: strings.contact, href: '#contact' },
  ];

  const handleHomeClick = () => {
    onNavigate('home');
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSectionNavigate = (href: string) => {
    if (currentPage !== 'home') {
      onNavigate('home');
      setTimeout(() => {
        document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return;
    }

    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between md:h-16">
            <button
              onClick={handleHomeClick}
              className="flex items-center gap-2 text-white transition-colors hover:text-cyan-400"
            >
              <Shield className="h-5 w-5 text-cyan-400 md:h-6 md:w-6" />
              <span className="text-sm font-bold uppercase tracking-widest">GMX AUDIT {locale.toUpperCase()}</span>
            </button>

            <div className="hidden items-center gap-6 md:flex">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={currentPage === 'home' ? link.href : '#'}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSectionNavigate(link.href);
                  }}
                  className="text-base text-slate-300 transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="#pricing"
                onClick={(e) => {
                  e.preventDefault();
                  handleSectionNavigate('#pricing');
                }}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-base font-semibold text-white transition-colors hover:bg-cyan-400"
              >
                {strings.viewPlans}
              </a>
            </div>

            <button
              className="p-2 text-slate-200 transition-colors hover:text-white md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? strings.closeMenu : strings.openMenu}
            >
              {mobileOpen ? <X className="h-7 w-7" /> : <Menu className="h-7 w-7" />}
            </button>
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label={strings.closeMenu}
            className="absolute inset-0 bg-slate-950/90"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-x-0 top-14 h-[calc(100vh-56px)] border-t border-slate-800 bg-slate-950 px-6 py-8">
            <div className="flex h-full flex-col justify-between">
              <div className="space-y-5">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={currentPage === 'home' ? link.href : '#'}
                    onClick={(e) => {
                      e.preventDefault();
                      setMobileOpen(false);
                      handleSectionNavigate(link.href);
                    }}
                    className="block rounded-xl border border-slate-800 px-4 py-3 text-base text-slate-200 transition-colors hover:border-cyan-500 hover:text-white"
                  >
                    {link.label}
                  </a>
                ))}
              </div>

              <a
                href="#pricing"
                onClick={(e) => {
                  e.preventDefault();
                  setMobileOpen(false);
                  handleSectionNavigate('#pricing');
                }}
                className="block rounded-xl bg-cyan-500 px-4 py-4 text-center text-lg font-semibold text-white transition-colors hover:bg-cyan-400"
              >
                {strings.viewPlans}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

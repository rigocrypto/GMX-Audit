import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Landing from './pages/Landing';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Support from './pages/Support';
import { DEFAULT_LOCALE, isSupportedLocale, LOCALE_BUNDLES, type LocaleCode } from './i18n/locales';

type Page = 'home' | 'privacy' | 'terms' | 'support';

const HASH_TO_PAGE: Record<string, Page> = {
  '': 'home',
  '#': 'home',
  '#home': 'home',
  '#privacy': 'privacy',
  '#terms': 'terms',
  '#support': 'support',
};

function getPageFromHash(): Page {
  const hash = window.location.hash.split('?')[0];
  return HASH_TO_PAGE[hash] ?? 'home';
}

function isPage(value: string): value is Page {
  return value === 'home' || value === 'privacy' || value === 'terms' || value === 'support';
}

function getLocaleFromPathname(pathname: string): LocaleCode | null {
  const base = import.meta.env.BASE_URL;
  const withoutBase = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\/+/, '');
  const localeSegment = withoutBase.split('/').filter(Boolean)[0] ?? null;
  return isSupportedLocale(localeSegment) ? localeSegment : null;
}

function getLocaleRootUrl(locale: LocaleCode): string {
  return `${import.meta.env.BASE_URL}${locale}/`;
}

export default function App() {
  const [page, setPage] = useState<Page>(getPageFromHash);
  const [locale, setLocale] = useState<LocaleCode>(() => getLocaleFromPathname(window.location.pathname) ?? DEFAULT_LOCALE);

  const navigate = (target: string) => {
    if (!isPage(target)) return;

    const PAGE_TO_HASH: Record<Page, string> = {
      home: '',
      privacy: '#privacy',
      terms: '#terms',
      support: '#support',
    };
    const nextHash = PAGE_TO_HASH[target];
    window.history.pushState(null, '', `${getLocaleRootUrl(locale)}${nextHash}`);
    setPage(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const currentLocale = getLocaleFromPathname(window.location.pathname);
    if (!currentLocale) {
      window.location.replace(getLocaleRootUrl(DEFAULT_LOCALE));
      return;
    }

    setLocale(currentLocale);
    document.documentElement.lang = LOCALE_BUNDLES[currentLocale].meta.languageTag;

    const handlePopState = () => setPage(getPageFromHash());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const strings = LOCALE_BUNDLES[locale].strings;

  return (
    <div className="min-h-screen bg-[#050d1a] font-sans">
      <Navbar currentPage={page} onNavigate={navigate} locale={locale} strings={strings.nav} />
      <main>
        {page === 'home' && <Landing onNavigate={navigate} locale={locale} />}
        {page === 'privacy' && <Privacy onNavigate={navigate} />}
        {page === 'terms' && <Terms onNavigate={navigate} />}
        {page === 'support' && <Support onNavigate={navigate} />}
      </main>
      <Footer onNavigate={navigate} locale={locale} strings={strings.footer} />
    </div>
  );
}

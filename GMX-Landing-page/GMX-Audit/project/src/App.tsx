import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Landing from './pages/Landing';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Support from './pages/Support';

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

export default function App() {
  const [page, setPage] = useState<Page>(getPageFromHash);

  const navigate = (target: Page) => {
    const PAGE_TO_HASH: Record<Page, string> = {
      home: '',
      privacy: '#privacy',
      terms: '#terms',
      support: '#support',
    };
    window.history.pushState(null, '', PAGE_TO_HASH[target] || '/');
    setPage(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const handlePopState = () => setPage(getPageFromHash());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div className="min-h-screen bg-[#050d1a] font-sans">
      <Navbar currentPage={page} onNavigate={navigate} />
      <main>
        {page === 'home' && <Landing onNavigate={navigate} />}
        {page === 'privacy' && <Privacy onNavigate={navigate} />}
        {page === 'terms' && <Terms onNavigate={navigate} />}
        {page === 'support' && <Support onNavigate={navigate} />}
      </main>
      <Footer onNavigate={navigate} />
    </div>
  );
}

import { useState } from 'react';
import { Shield, Menu, X } from 'lucide-react';

interface NavbarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export default function Navbar({ currentPage, onNavigate }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { label: 'Services', href: '#services' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'FAQ', href: '#faq' },
    { label: 'Contact', href: '#contact' },
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
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#050d1a]/95 backdrop-blur-sm border-b border-[#1a2f4a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 md:h-16">
          <button
            onClick={handleHomeClick}
            className="flex items-center gap-2 text-white hover:text-[#0ea5e9] transition-colors"
          >
            <Shield className="w-5 h-5 md:w-6 md:h-6 text-[#0ea5e9]" />
            <span className="font-bold text-xs md:text-sm tracking-wider uppercase">GMX Audit</span>
          </button>

          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={currentPage === 'home' ? link.href : '#'}
                onClick={() => {
                  if (currentPage !== 'home') {
                    onNavigate('home');
                    setTimeout(() => {
                      document.querySelector(link.href)?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }
                }}
                className="text-[#94a3b8] hover:text-white text-sm transition-colors"
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
              className="px-4 py-1.5 bg-[#0ea5e9] hover:bg-[#0284c7] text-white text-sm font-medium rounded transition-colors"
            >
              View Plans
            </a>
          </div>

          <button
            className="md:hidden text-[#94a3b8] hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[#050d1a] border-b border-[#1a2f4a] px-4 py-3 flex flex-col gap-3">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={currentPage === 'home' ? link.href : '#'}
              onClick={() => setMobileOpen(false)}
              className="text-[#94a3b8] hover:text-white text-sm transition-colors"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#pricing"
            onClick={(e) => {
              e.preventDefault();
              setMobileOpen(false);
              handleSectionNavigate('#pricing');
            }}
            className="px-4 py-2 bg-[#0ea5e9] hover:bg-[#0284c7] text-white text-sm font-medium rounded text-center transition-colors"
          >
            View Plans
          </a>
        </div>
      )}
    </nav>
  );
}

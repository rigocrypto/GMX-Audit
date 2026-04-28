import path from 'node:path';
import { promises as fs } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_LOCALE, LOCALE_BUNDLES, SUPPORTED_LOCALES, type LocaleCode } from './src/i18n/locales';

const SITE_URL = 'https://rigocrypto.github.io/bounty-rotation-harness';

function localeUrl(locale: LocaleCode): string {
  return `${SITE_URL}/${locale}/`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function alternateLinks(): string {
  const localeLinks = SUPPORTED_LOCALES.map((locale) => {
    const tag = LOCALE_BUNDLES[locale].meta.languageTag;
    return `<link rel="alternate" hreflang="${tag}" href="${localeUrl(locale)}" />`;
  }).join('\n    ');

  return `${localeLinks}\n    <link rel="alternate" hreflang="x-default" href="${localeUrl(DEFAULT_LOCALE)}" />`;
}

function localizedJsonLd(locale: LocaleCode): string {
  const meta = LOCALE_BUNDLES[locale].meta;
  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: 'GMX Audit Control Center',
          url: localeUrl(locale),
          logo: `${SITE_URL}/Bounty-rotation.jpeg`,
          email: 'mailto:rigovivas71@gmail.com',
        },
        {
          '@type': 'SoftwareApplication',
          name: 'GMX Audit Control Center',
          applicationCategory: 'SecurityApplication',
          operatingSystem: 'Web',
          description: meta.description,
          url: localeUrl(locale),
          provider: {
            '@type': 'Organization',
            name: 'GMX Audit Control Center',
          },
        },
      ],
    },
    null,
    2
  );
}

function prerenderLocaleHtml(html: string, locale: LocaleCode): string {
  const meta = LOCALE_BUNDLES[locale].meta;
  const ogLocale = meta.languageTag.replace('-', '_');
  const localeHref = localeUrl(locale);

  const localized = html
    .replace(/<html lang="[^"]+">/, `<html lang="${meta.languageTag}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/, `<meta name="description" content="${escapeHtml(meta.description)}" />`)
    .replace(/<meta\s+property="og:title"\s+content="[\s\S]*?"\s*\/>/, `<meta property="og:title" content="${escapeHtml(meta.title)}" />`)
    .replace(/<meta\s+property="og:description"\s+content="[\s\S]*?"\s*\/>/, `<meta property="og:description" content="${escapeHtml(meta.description)}" />`)
    .replace(/<meta\s+property="og:url"\s+content="[\s\S]*?"\s*\/>/, `<meta property="og:url" content="${localeHref}" />`)
    .replace(/<meta\s+property="og:locale"\s+content="[\s\S]*?"\s*\/>/, `<meta property="og:locale" content="${ogLocale}" />`)
    .replace(/<meta\s+name="twitter:title"\s+content="[\s\S]*?"\s*\/>/, `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`)
    .replace(/<meta\s+name="twitter:description"\s+content="[\s\S]*?"\s*\/>/, `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`)
    .replace(/<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/>/, `<link rel="canonical" href="${localeHref}" />`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${localizedJsonLd(locale)}\n    </script>`);

  return localized.replace('</head>', `    ${alternateLinks()}\n  </head>`);
}

function localePrerenderPlugin(): Plugin {
  return {
    name: 'locale-prerender',
    apply: 'build',
    async closeBundle() {
      const distRoot = path.resolve(__dirname, 'dist');
      const indexPath = path.join(distRoot, 'index.html');
      const rootHtml = await fs.readFile(indexPath, 'utf8');

      for (const locale of SUPPORTED_LOCALES) {
        const localeDir = path.join(distRoot, locale);
        await fs.mkdir(localeDir, { recursive: true });
        await fs.writeFile(path.join(localeDir, 'index.html'), prerenderLocaleHtml(rootHtml, locale), 'utf8');
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/bounty-rotation-harness/' : '/',
  plugins: [react(), localePrerenderPlugin()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});

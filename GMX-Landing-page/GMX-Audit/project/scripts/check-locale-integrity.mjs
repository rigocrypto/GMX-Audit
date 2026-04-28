import fs from 'node:fs';
import path from 'node:path';

const localesPath = path.resolve(process.cwd(), 'src/i18n/locales.ts');
const source = fs.readFileSync(localesPath, 'utf8');

const locales = ['en', 'es', 'fr'];
const requiredKeys = [
  'languageTag',
  'title',
  'description',
  'services',
  'pricing',
  'howItWorks',
  'faq',
  'contact',
  'viewPlans',
  'openMenu',
  'closeMenu',
  'summary',
  'privacy',
  'terms',
  'support',
  'rights',
];

const missing = [];

for (const locale of locales) {
  const localePattern = new RegExp(`\\b${locale}\\s*:\\s*\\{`, 'm');
  if (!localePattern.test(source)) {
    missing.push(`Missing locale block: ${locale}`);
    continue;
  }

  for (const key of requiredKeys) {
    const keyPattern = new RegExp(`\\b${key}\\s*:\\s*['\"]`, 'm');
    if (!keyPattern.test(source)) {
      missing.push(`${locale}: missing key "${key}"`);
    }
  }
}

if (missing.length > 0) {
  console.error('✗ Locale integrity check FAILED:');
  for (const msg of missing) {
    console.error(`  - ${msg}`);
  }
  process.exit(1);
}

console.log('✓ Locale integrity check passed for en/es/fr.');

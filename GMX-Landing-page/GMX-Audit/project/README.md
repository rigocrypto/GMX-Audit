# GMX Audit Control Center

A multilingual SEO-optimized landing page for GMX audit and security monitoring services.

## Features

- **React 18 + TypeScript** — Type-safe component architecture
- **Vite 5** — Lightning-fast dev server and production builds
- **Tailwind CSS 3** — Responsive, utility-first styling
- **Multilingual Support** — en/es/fr with prerendered static HTML
- **SEO Baseline** — Canonical URLs, hreflang alternates, JSON-LD schema, OG/Twitter metadata
- **Build-Time Validation** — Locale integrity check ensures no missing translations

## Project Structure

```
src/
  ├── App.tsx              # Root component with locale routing
  ├── pages/
  │   └── Landing.tsx      # Main landing page
  ├── components/
  │   ├── Navbar.tsx
  │   └── Footer.tsx
  └── i18n/
      └── locales.ts       # Centralized locale metadata & strings
public/
  ├── robots.txt
  └── sitemap.xml
scripts/
  └── check-locale-integrity.mjs  # Build-time validation script
```

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development

```bash
npm run dev
```

Starts a local dev server at `http://localhost:5173`. The app detects locale from the URL path:
- `/en/` — English
- `/es/` — Español
- `/fr/` — Français

### Build

```bash
npm run build
```

Generates a production bundle in `dist/` with prerendered HTML for all three locales:
- `dist/en/index.html`
- `dist/es/index.html`
- `dist/fr/index.html`

The build script runs `check:locales` as a prebuild hook to validate locale integrity before bundling.

### Type Checking

```bash
npm run typecheck
```

Validates all TypeScript code before deploy.

## Internationalization (i18n)

Locale data is defined in `src/i18n/locales.ts`:

```typescript
LOCALE_BUNDLES: Record<LocaleCode, LocaleBundle>
```

Each bundle contains:
- **meta**: Language tag, page title, description
- **strings**: Navbar, footer, and UI labels for that locale

Adding a new locale:
1. Add entry to `LOCALE_BUNDLES` with all 16 required keys
2. Run `npm run build` — the integrity check will verify completeness
3. Update `SUPPORTED_LOCALES` array if needed

## Prerendering & SEO

The Vite build uses a custom `localePrerenderPlugin` that:

1. Generates the base `dist/index.html` with default (English) metadata
2. Creates locale-specific folders (`dist/{locale}/index.html`) during the bundle close
3. Injects locale-specific metadata into each:
   - `lang` attribute
   - `<title>` tag
   - `<meta property="og:*">` tags
   - `<link rel="canonical">` pointing to locale-specific URL
   - `<link rel="alternate" hreflang>` tags for all locales + x-default
   - `<script type="application/ld+json">` with localized schema

All canonical URLs are **locale-specific** (e.g., `/en/` points to itself, not `/`) to avoid duplicate content penalties.

## Routing

- **Root (`/`)** → Client-side JS redirects to `/en/`
- **Locale routes** (`/en/`, `/es/`, `/fr/`) → Prerendered static HTML
- **Hash-based pages** → `#/privacy`, `#/terms`, `#/support` (accessible from any locale)

## Known Limitations

- **Root redirect**: `/` → `/en/` is currently a JS-based soft redirect, not a server-side 301.
  GitHub Pages doesn't support redirect rules. When migrating to Vercel or Netlify,
  add a proper 301 via `_redirects` or `vercel.json` to ensure social crawlers and SEO bots
  follow the redirect.

## Deployment

### GitHub Pages

The app is configured for deployment to GitHub Pages at `https://rigocrypto.github.io/bounty-rotation-harness/`.

Set `BASE_URL` in `vite.config.ts` to match your repository path.

### Vercel / Netlify

When moving to Vercel or Netlify:
1. Update `BASE_URL` in `vite.config.ts` (likely `/`)
2. Add `_redirects` (Netlify) or `vercel.json` (Vercel) with a 301 rule for root redirect
3. Ensure `robots.txt` and `sitemap.xml` point to the correct domain

## Monitoring

After deployment:

1. **Submit sitemap to Google Search Console** — Ensures all locale pages are indexed
2. **Test social preview** — Share a locale URL on Twitter/LinkedIn to verify OG metadata is being served
3. **Monitor GSC for 7–10 days** — Identify which keywords and pages are gaining visibility
4. **Use data to prioritize Phase 3** — Localize content based on actual search demand

## Scripts

- `npm run dev` — Start development server
- `npm run build` — Production build with prerender
- `npm run preview` — Preview production build locally
- `npm run typecheck` — TypeScript validation
- `npm run check:locales` — Validate locale integrity (also runs as prebuild hook)

## License

[Your License Here]

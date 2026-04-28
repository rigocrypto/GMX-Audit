export const SUPPORTED_LOCALES = ['en', 'es', 'fr'] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export type LocaleMeta = {
  languageTag: string;
  title: string;
  description: string;
};

export type LocaleStrings = {
  nav: {
    services: string;
    pricing: string;
    howItWorks: string;
    faq: string;
    contact: string;
    viewPlans: string;
    openMenu: string;
    closeMenu: string;
  };
  footer: {
    summary: string;
    privacy: string;
    terms: string;
    support: string;
    rights: string;
  };
};

export type LocaleBundle = {
  meta: LocaleMeta;
  strings: LocaleStrings;
};

export const LOCALE_BUNDLES: Record<LocaleCode, LocaleBundle> = {
  en: {
    meta: {
      languageTag: 'en-US',
      title: 'GMX Audit Control Center',
      description:
        'Security monitoring, CI coverage, regression support, and audit-oriented operational support for teams shipping critical infrastructure.',
    },
    strings: {
      nav: {
        services: 'Services',
        pricing: 'Pricing',
        howItWorks: 'How It Works',
        faq: 'FAQ',
        contact: 'Contact',
        viewPlans: 'View Plans',
        openMenu: 'Open menu',
        closeMenu: 'Close menu',
      },
      footer: {
        summary:
          'Digital engineering support, monitoring, and audit-related services for protocol, smart contract, and infrastructure teams.',
        privacy: 'Privacy Policy',
        terms: 'Terms of Service',
        support: 'Support',
        rights: 'All rights reserved.',
      },
    },
  },
  es: {
    meta: {
      languageTag: 'es-ES',
      title: 'Centro de Control de Auditoria GMX',
      description:
        'Monitoreo de seguridad, cobertura de CI, soporte de regresion y soporte operativo orientado a auditorias para equipos que lanzan infraestructura critica.',
    },
    strings: {
      nav: {
        services: 'Servicios',
        pricing: 'Precios',
        howItWorks: 'Como Funciona',
        faq: 'Preguntas',
        contact: 'Contacto',
        viewPlans: 'Ver Planes',
        openMenu: 'Abrir menu',
        closeMenu: 'Cerrar menu',
      },
      footer: {
        summary:
          'Soporte digital de ingenieria, monitoreo y servicios relacionados con auditorias para equipos de protocolos, contratos inteligentes e infraestructura.',
        privacy: 'Politica de Privacidad',
        terms: 'Terminos del Servicio',
        support: 'Soporte',
        rights: 'Todos los derechos reservados.',
      },
    },
  },
  fr: {
    meta: {
      languageTag: 'fr-FR',
      title: 'Centre de Controle d Audit GMX',
      description:
        'Surveillance de securite, couverture CI, support de regression et support operationnel oriente audit pour les equipes qui livrent une infrastructure critique.',
    },
    strings: {
      nav: {
        services: 'Services',
        pricing: 'Tarifs',
        howItWorks: 'Fonctionnement',
        faq: 'FAQ',
        contact: 'Contact',
        viewPlans: 'Voir les Offres',
        openMenu: 'Ouvrir le menu',
        closeMenu: 'Fermer le menu',
      },
      footer: {
        summary:
          'Support numerique d ingenierie, surveillance et services lies aux audits pour les equipes protocole, smart contract et infrastructure.',
        privacy: 'Politique de Confidentialite',
        terms: 'Conditions d Utilisation',
        support: 'Support',
        rights: 'Tous droits reserves.',
      },
    },
  },
};

export const DEFAULT_LOCALE: LocaleCode = 'en';

export function isSupportedLocale(value: string | null | undefined): value is LocaleCode {
  return value ? SUPPORTED_LOCALES.includes(value as LocaleCode) : false;
}

export function getLocalePathPrefix(locale: LocaleCode): string {
  return `/${locale}/`;
}

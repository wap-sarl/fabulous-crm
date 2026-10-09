import type { Id, LandingSection } from '@crm/lib/backend';

export interface LandingTemplate {
  key: string;
  label: string;
  description: string;
  /** The blocks, with the form the person chose where a form goes; without one, no form block. */
  sections: (formId: Id<'forms'> | undefined) => LandingSection[];
}

const id = () => crypto.randomUUID();

const form = (formId: Id<'forms'> | undefined, heading: string): LandingSection[] =>
  formId ? [{ id: id(), type: 'form', formId, heading }] : [];

/** The pages one starts from; each is a draft to make one's own. */
export const LANDING_TEMPLATES: LandingTemplate[] = [
  {
    key: 'demo',
    label: 'Demande de démo',
    description: 'Un titre, trois arguments, le formulaire et un rappel à l’action.',
    sections: (formId) => [
      {
        id: id(),
        type: 'hero',
        heading: 'Découvrez le produit en trente minutes',
        text: 'Une démonstration personnalisée, sans engagement, au créneau de votre choix.',
        ctaLabel: 'Demander une démo',
        ctaHref: formId ? '#form' : 'https://example.com',
      },
      {
        id: id(),
        type: 'text',
        html: '<h2>Ce que vous verrez</h2><ul><li>Vos cas d’usage, pas une visite guidée.</li><li>Les réponses à vos questions, en direct.</li><li>Un chiffrage clair à la fin.</li></ul>',
      },
      ...form(formId, 'Vos coordonnées'),
      {
        id: id(),
        type: 'cta',
        heading: 'Une question avant ?',
        text: 'Écrivez-nous, nous répondons dans la journée.',
        label: 'Nous écrire',
        href: 'https://example.com/contact',
      },
    ],
  },
  {
    key: 'guide',
    label: 'Livre blanc',
    description: 'Un contenu à télécharger contre une adresse e-mail.',
    sections: (formId) => [
      {
        id: id(),
        type: 'hero',
        heading: 'Le guide complet, en vingt pages',
        text: 'Tout ce qu’il faut savoir avant de se lancer, par ceux qui l’ont fait.',
        ctaLabel: 'Recevoir le guide',
        ctaHref: formId ? '#form' : 'https://example.com',
      },
      {
        id: id(),
        type: 'text',
        html: '<h2>Au sommaire</h2><p>Les erreurs classiques, les bons réflexes, et une grille pour décider.</p>',
      },
      ...form(formId, 'Où envoyer le guide ?'),
    ],
  },
  {
    key: 'event',
    label: 'Événement',
    description: 'Une date, un lieu, un programme et l’inscription.',
    sections: (formId) => [
      {
        id: id(),
        type: 'hero',
        heading: 'Rendez-vous le 12 novembre',
        text: 'Une matinée d’ateliers et de rencontres, à Lyon, places limitées.',
        ctaLabel: 'Je m’inscris',
        ctaHref: formId ? '#form' : 'https://example.com',
      },
      {
        id: id(),
        type: 'text',
        html: '<h2>Programme</h2><p><strong>9 h</strong> Accueil · <strong>9 h 30</strong> Ateliers · <strong>12 h</strong> Déjeuner</p>',
      },
      ...form(formId, 'Inscription'),
    ],
  },
  {
    key: 'blank',
    label: 'Page vide',
    description: 'Aucun bloc : composez la page.',
    sections: () => [],
  },
];

/** A new block of a type, with what its fields need to be valid once filled. */
export function emptySection(type: LandingSection['type'], formId?: Id<'forms'>): LandingSection {
  switch (type) {
    case 'hero':
      return { id: id(), type, heading: '' };
    case 'text':
      return { id: id(), type, html: '' };
    case 'image':
      return { id: id(), type, url: '', alt: '' };
    case 'cta':
      return { id: id(), type, heading: '', label: '', href: '' };
    case 'form':
      return { id: id(), type, formId: formId as Id<'forms'>, heading: '' };
  }
}

/** The blocks again, each with an id of its own: what a variant starts from. */
export const copySections = (sections: LandingSection[]): LandingSection[] =>
  sections.map((section) => ({ ...section, id: id() }));

export const SECTION_LABEL: Record<LandingSection['type'], string> = {
  hero: 'Bandeau',
  text: 'Texte',
  image: 'Image',
  form: 'Formulaire',
  cta: 'Appel à l’action',
};

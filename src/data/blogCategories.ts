export const BLOG_CATEGORY_META: Record<string, { label: string; color: string; serviceUrl: string }> = {
  'web-design': {
    label: 'Web Design',
    color: '#7c3aed',
    serviceUrl: '/services/web-design/',
  },
  'web-development': {
    label: 'Web Development',
    color: '#0f766e',
    serviceUrl: '/services/web-development/',
  },
  'ecommerce-development': {
    label: 'Ecommerce Web Design',
    color: '#db2777',
    serviceUrl: '/services/ecommerce-development/',
  },
  'logo-design': {
    label: 'Logo Design',
    color: '#d97706',
    serviceUrl: '/services/logo-design/',
  },
  'managed-starter-websites': {
    label: 'Managed Starter Websites',
    color: '#16a34a',
    serviceUrl: '/services/managed-starter-websites/',
  },
  'website-hosting-security': {
    label: 'Hosting & Security',
    color: '#dc2626',
    serviceUrl: '/services/website-hosting-security/',
  },
  'website-maintenance-packages': {
    label: 'Website Maintenance',
    color: '#ca8a04',
    serviceUrl: '/services/website-maintenance-packages/',
  },
  seo: {
    label: 'Local SEO',
    color: '#2563eb',
    serviceUrl: '/services/local-seo-google-ranking/',
  },
  news: {
    label: 'News',
    color: '#6b7280',
    serviceUrl: '',
  },
};

export const BLOG_CATEGORY_ORDER = [
  'web-design',
  'web-development',
  'ecommerce-development',
  'logo-design',
  'managed-starter-websites',
  'website-hosting-security',
  'website-maintenance-packages',
  'seo',
  'news',
];

export function getBlogCategoryLabel(category?: string): string {
  if (!category) return '';
  return BLOG_CATEGORY_META[category]?.label ?? category.replace(/-/g, ' ');
}

import { config, collection, singleton, fields } from '@keystatic/core';

export default config({
  storage: { kind: 'local' },

  ui: {
    brand: { name: 'NC Digital' },
  },

  collections: {

    blog: collection({
      label: 'Blog Posts',
      slugField: 'title',
      path: 'src/content/blog/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        pubDate: fields.date({ label: 'Published Date' }),
        description: fields.text({ label: 'Excerpt', multiline: true }),
        heroImage: fields.image({
          label: 'Hero Image',
          directory: 'src/assets/blog',
          publicPath: '../../../assets/blog/',
        }),
        heroImageAlt: fields.text({
          label: 'Hero Image Alt Text',
          description: 'Describes the hero image for screen readers and search engines.',
        }),
        category: fields.select({
          label: 'Category',
          options: [
            { label: 'Web Design', value: 'web-design' },
            { label: 'Web Development', value: 'web-development' },
            { label: 'Ecommerce Web Design', value: 'ecommerce-development' },
            { label: 'Logo Design', value: 'logo-design' },
            { label: 'Managed Starter Websites', value: 'managed-starter-websites' },
            { label: 'Hosting & Security', value: 'website-hosting-security' },
            { label: 'Website Maintenance', value: 'website-maintenance-packages' },
            { label: 'Local SEO', value: 'seo' },
            { label: 'News', value: 'news' },
          ],
          defaultValue: 'web-design',
        }),
        location: fields.multiselect({
          label: 'Locations',
          description: 'Tag this post with the locations it is relevant to.',
          options: [
            { label: 'South Wales', value: 'south-wales' },
            { label: 'Merthyr Tydfil', value: 'merthyr-tydfil' },
            { label: 'Cardiff', value: 'cardiff' },
            { label: 'Swansea', value: 'swansea' },
            { label: 'Newport', value: 'newport' },
            { label: 'Bridgend', value: 'bridgend' },
            { label: 'Pontypridd', value: 'pontypridd' },
            { label: 'Caerphilly', value: 'caerphilly' },
            { label: 'Aberdare', value: 'aberdare' },
            { label: 'Rhondda', value: 'rhondda' },
            { label: 'Barry', value: 'barry' },
            { label: 'Neath', value: 'neath' },
            { label: 'Port Talbot', value: 'port-talbot' },
            { label: 'Cwmbran', value: 'cwmbran' },
            { label: 'Llanelli', value: 'llanelli' },
          ],
        }),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Content' }),
      },
    }),

    portfolio: collection({
      label: 'Portfolio',
      slugField: 'title',
      path: 'src/content/portfolio/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Project Name' } }),
        client: fields.text({ label: 'Client Name' }),
        services: fields.multiselect({
          label: 'Services Provided',
          options: [
            { label: 'Web Design', value: 'web-design' },
            { label: 'Web Development', value: 'web-development' },
            { label: 'Local SEO', value: 'seo' },
            { label: 'Hosting', value: 'hosting' },
          ],
        }),
        industry: fields.multiselect({
          label: 'Industry',
          options: [
            { label: 'Trades', value: 'trades' },
            { label: 'Property', value: 'property' },
            { label: 'Energy Renewal', value: 'energy' },
            { label: 'Events & Promotions', value: 'events' },
            { label: 'Ecommerce', value: 'ecommerce' },
          ],
        }),
        heroImage: fields.image({
          label: 'Project Image',
          directory: 'src/assets/portfolio',
          publicPath: '../../assets/portfolio/',
        }),
        summary: fields.text({ label: 'Short Summary', multiline: true }),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Case Study Content' }),
      },
    }),

    services: collection({
      label: 'Services',
      slugField: 'title',
      path: 'src/content/services/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Service Name' } }),
        headline: fields.text({ label: 'Hero Headline' }),
        description: fields.text({ label: 'Short Description', multiline: true }),
        features: fields.array(
          fields.text({ label: 'Feature' }),
          { label: 'Key Features', itemLabel: (props: { value: string }) => props.value }
        ),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Page Content' }),
      },
    }),

    locations: collection({
      label: 'Location Pages',
      slugField: 'title',
      path: 'src/content/locations/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Page Title' } }),
        town: fields.text({ label: 'Town / City' }),
        county: fields.text({ label: 'County' }),
        serviceType: fields.select({
          label: 'Service Type',
          options: [
            { label: 'Web Design', value: 'web-design' },
            { label: 'SEO', value: 'seo' },
            { label: 'Both', value: 'both' },
          ],
          defaultValue: 'web-design',
        }),
        headline: fields.text({ label: 'Hero Headline' }),
        metaTitle: fields.text({ label: 'Meta Title' }),
        metaDescription: fields.text({ label: 'Meta Description', multiline: true }),
        content: fields.markdoc({ label: 'Page Content' }),
      },
    }),

  },

  singletons: {

    siteSettings: singleton({
      label: 'Site Settings',
      path: 'src/content/settings',
      schema: {
        heroHeadline: fields.text({ label: 'Hero Headline' }),
        heroSubtext: fields.text({ label: 'Hero Subtext', multiline: true }),
        heroCTAPrimary: fields.text({ label: 'Primary CTA Text' }),
        heroCTASecondary: fields.text({ label: 'Secondary CTA Text' }),
        aboutText: fields.text({ label: 'About Section Text', multiline: true }),
        phone: fields.text({ label: 'Phone Number' }),
        email: fields.text({ label: 'Email Address' }),
        address: fields.text({ label: 'Address' }),
        facebookUrl: fields.url({ label: 'Facebook URL' }),
        instagramUrl: fields.url({ label: 'Instagram URL' }),
        linkedinUrl: fields.url({ label: 'LinkedIn URL' }),
      },
    }),

  },
});

import { collection, config, fields } from '@keystatic/core';
import { componentBlocks } from './src/blocks';

export default config({
  storage: {
    kind: 'local'
  },
  collections: {
    pages: collection({
      label: 'Pages',
      path: 'src/content/pages/*',
      slugField: 'slug',
      format: { contentField: 'content' },
      schema: {
        slug: fields.slug({
          name: {
            label: 'Slug',
            validation: { isRequired: true }
          }
        }),
        title: fields.text({ label: 'Title', validation: { isRequired: true } }),
        description: fields.text({ label: 'Description', multiline: true }),
        heading: fields.text({ label: 'Main heading' }),
        content: fields.markdoc({
          label: 'Page content',
          options: {
            image: {
              directory: 'public/images/content',
              publicPath: '/images/content/'
            }
          },
          components: componentBlocks
        })
      }
    })
  }
});

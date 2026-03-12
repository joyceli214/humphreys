import { collection, config, fields } from '@keystatic/core';
import { componentBlocks } from './src/blocks';

export default config({
  storage: {
    kind: 'local'
  },
  singletons: {
    siteSettings: {
      label: 'Site Settings',
      path: 'src/content/settings/site',
      format: { data: 'json' },
      schema: {
        topBarItems: fields.array(
          fields.object(
            {
              text: fields.text({
                label: 'Item text',
                validation: { isRequired: true }
              })
            },
            { label: 'Top bar item' }
          ),
          {
            label: 'Top bar scroller items',
            itemLabel: (props) => props.fields.text.value || 'New item'
          }
        ),
        menuItems: fields.array(
          fields.object(
            {
              label: fields.text({
                label: 'Menu label',
                validation: { isRequired: true }
              }),
              href: fields.text({
                label: 'Menu link',
                validation: { isRequired: true }
              })
            },
            { label: 'Header menu item' }
          ),
          {
            label: 'Header menu items',
            itemLabel: (props) => props.fields.label.value || 'New menu item'
          }
        ),
        headerActions: fields.object({
          primary: fields.object({
            enabled: fields.checkbox({ label: 'Enable primary action', defaultValue: true }),
            label: fields.text({ label: 'Primary label', validation: { isRequired: true } }),
            href: fields.text({ label: 'Primary link', validation: { isRequired: true } })
          }),
          secondary: fields.object({
            enabled: fields.checkbox({ label: 'Enable secondary action', defaultValue: true }),
            label: fields.text({ label: 'Secondary label', validation: { isRequired: true } }),
            href: fields.text({ label: 'Secondary link', validation: { isRequired: true } })
          })
        })
      }
    }
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

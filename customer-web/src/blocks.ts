import { fields } from '@keystatic/core';
import { wrapper } from '@keystatic/core/content-components';

export const componentBlocks = {
  mediaText: wrapper({
    label: 'Media & Text Block',
    schema: {
      image: fields.image({
        label: 'Image',
        directory: 'public/images/blocks',
        publicPath: '/images/blocks/'
      }),
      imagePosition: fields.select({
        label: 'Image Position',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Right', value: 'right' }
        ],
        defaultValue: 'left'
      })
    }
  })
};

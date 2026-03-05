import { component } from '@astrojs/markdoc/config';

export default {
  tags: {
    mediaText: {
      render: component('./src/components/markdoc/MediaText.astro'),
      attributes: {
        image: { type: String },
        imagePosition: { type: String, default: 'left' }
      }
    }
  }
};

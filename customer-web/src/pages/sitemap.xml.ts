import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://www.humphreysrepaircentre.com';

export const GET: APIRoute = async () => {
  const pages = await getCollection('pages');

  const urls = pages
    .map((entry) => {
      const path = entry.id === 'home' ? '' : `/${entry.id}`;
      return `<url><loc>${SITE}${path}</loc><priority>1.0</priority><changefreq>monthly</changefreq></url>`;
    })
    .join('');

  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
};

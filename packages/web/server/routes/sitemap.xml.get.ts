export default defineEventHandler((event) => {
  // No sitemap is published yet. Answer crawlers with a plain 404 instead of letting
  // the CMS catch-all render (and hydrate) a full error page for an XML request.
  setResponseStatus(event, 404);
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
  setResponseHeader(event, 'cache-control', 'public, max-age=3600');
  return 'Not Found';
});

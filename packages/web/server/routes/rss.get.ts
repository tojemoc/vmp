import { publicRssFeedUrl } from '../../utils/unroutedPaths';

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const target = publicRssFeedUrl(config.public.apiUrl as string);

  if (!target) {
    setResponseStatus(event, 404);
    setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
    return 'Not Found';
  }

  // Temporary: the target follows API_URL, which differs per deployment tier.
  return sendRedirect(event, target, 302);
});

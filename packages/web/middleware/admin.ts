/**
 * packages/web/middleware/admin.ts
 *
 * Route guard for /admin/* pages.
 * Requires the user to be logged in AND have role editor, admin, or super_admin.
 *
 * Unauthenticated → /login?redirect=<current path>
 * Authenticated but wrong role → / (homepage, with no explanation — security by obscurity)
 *
 * How Nuxt middleware timing works:
 *   The auth.client.ts plugin runs on app boot and calls refreshSession(), which
 *   populates user.value from the HttpOnly cookie before any navigation guard fires.
 *   So by the time this middleware runs, useAuth() already reflects the real session state.
 */
import { isInstalledPwa } from '~/utils/pwa'

export default defineNuxtRouteMiddleware(async (to) => {
  const { user, canEditContent } = useAuth()
  const { startLoginFlow } = useLoginFlow()
  console.log('[ROUTE AUTH]', {
    path: to.path,
    authenticated: !!user.value,
    standalone: isInstalledPwa(),
  })

  if (!user.value) {
    // Not logged in — send to login with a redirect param so they land back
    // on the admin page after authenticating.
    await startLoginFlow(to.fullPath)
    return abortNavigation()
  }

  if (!canEditContent.value) {
    // Logged in but insufficient role (e.g. a regular viewer somehow hit /admin)
    return navigateTo('/')
  }

  // Editor+ users who haven't set up 2FA yet must complete setup before accessing admin.
  // Forward the original path so setup can redirect back here after completion.
  if (user.value.totpRequired && !user.value.totpEnabled) {
    return navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})

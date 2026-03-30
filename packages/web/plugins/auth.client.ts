/**
 * packages/web/plugins/auth.client.ts
 *
 * Runs once on the client when the app boots.
 * Calls refreshSession() to silently restore the user's session from the
 * HttpOnly refresh cookie — so a logged-in user never sees a "logged out"
 * flash on page reload.
 *
 * The .client suffix means Nuxt only runs this plugin in the browser,
 * never during SSR.  That's correct here because the refresh cookie is
 * browser-side and the JWT lives in memory.
 */

export default defineNuxtPlugin(async () => {
  const { initialise } = useAuth()
  await initialise()
})

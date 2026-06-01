/**
 * Centralized UI copy for i18n preparation.
 *
 * Viewer-facing strings (homepage, watch, account, auth, checkout) are wired
 * through SFCs and composables. Admin dashboard copy lives under `strings.admin`
 * as an inventory for a later pass — `pages/admin/index.vue` is not fully
 * migrated yet (~6k lines).
 *
 * Next step for real locales: split into `locales/en.ts`, `locales/sk.ts`, etc.,
 * or export this object to Crowdin/Weblate as JSON.
 */

export type PlanType = 'monthly' | 'yearly' | 'club'
export type PaymentProvider = 'stripe' | 'gocardless'

const strings = {
  // ── Site-wide ──────────────────────────────────────────────────────────────
  siteName: 'Video Monetization Platform',
  siteNameShort: 'VMP',
  siteDescription: 'Premium video content platform',

  // ── Header / roles ─────────────────────────────────────────────────────────
  signIn: 'Sign in',
  signOut: 'Sign out',
  accountMenu: 'Open account menu',
  signedInAs: 'Signed in as',
  adminConsole: 'Admin console',
  account: 'Account',
  enableNotifications: 'Enable notifications',
  disableNotifications: 'Disable notifications',
  notificationsBlocked: 'Notifications blocked by browser',
  notificationsBlockedSettings: 'Notifications are blocked in your browser settings.',
  notificationsOn: 'Notifications on — click to disable',
  notificationsClickEnable: 'Click to enable new video notifications',
  notificationsUnsupportedContext: 'Notifications are unavailable in this browser context.',
  notificationsUnsupportedIosSafari:
    'On iPhone/iPad, add this site to your Home Screen and open it as an installed web app to enable notifications.',
  notificationsUnsupportedSafari: 'This Safari context does not currently support web push for this app.',
  notificationsEnabled: 'Notifications enabled.',
  notificationsTurnedOff: 'Notifications turned off.',
  notificationsBrowserBlocked:
    'Browser notifications were blocked. Enable notifications in your browser settings and try again.',
  notificationsNotConfigured: 'Push service is not configured right now. Please try again later.',
  notificationsEnableFailed: 'Failed to enable notifications. Please try again.',
  notificationsUnsubscribeSyncFailed:
    'Notifications were disabled in this browser, but we could not sync this change to the server.',
  serverError: 'Server error',

  roleSuperAdmin: 'Owner',
  roleAdmin: 'Admin',
  roleEditor: 'Editor',
  roleAnalyst: 'Analyst',
  roleModerator: 'Mod',
  roleViewer: 'Viewer',

  // ── Login (magic link) ─────────────────────────────────────────────────────
  loginTitle: 'Sign in',
  loginSubtitle: "We'll email you a sign-in link. No password needed.",
  loginEmailLabel: 'Email address',
  loginEmailPlaceholder: 'you@example.com',
  loginSendLink: 'Send sign-in link',
  loginSending: 'Sending…',
  loginMagicLinkSent: '✓ Check your inbox — a sign-in link is on its way.',
  loginMagicLinkExpires: 'It expires in 15 minutes.',
  loginSessionFlowHint:
    'If this browser does not open the link inside the app, copy/paste it into this browser to keep your session flow consistent.',
  loginOpenEmailApp: 'Open your email app',
  loginOpenGmail: 'Gmail',
  loginOpenOutlook: 'Outlook',
  loginOpenEmailHint: 'Use your default mail app, or open webmail in a new tab.',
  loginTerms: 'By signing in, you agree to our terms of service.',
  loginErrorGeneric: 'Something went wrong. Please try again.',

  // ── Magic link / PWA handoff (auth/verify) ────────────────────────────────
  authVerifySigningIn: 'Signing you in…',
  authVerifyHandoffTitle: 'Open the VMP app',
  authVerifyHandoffBody:
    "On iPhone and iPad, the app you added to your Home Screen is separate from Safari. Open VMP from your Home Screen and the app will attempt to finish signing in. If it doesn't complete, return to Safari and use the button below.",
  authVerifyHandoffContinueSafari: 'Continue in Safari',
  authVerifyHandoffCopyLink: 'Copy sign-in link',
  authVerifyHandoffCopied: 'Link copied',
  authVerifyErrorGeneric: 'Something went wrong. Please request a new sign-in link.',
  authVerifySignInIncomplete: 'Sign-in incomplete',
  authVerifyNoToken: 'No token found in the URL. Try clicking the link in your email again.',

  pwaLoginTitle: 'Sign in to the app',
  pwaLoginIntro: 'This takes a few extra steps the first time. Follow each step carefully.',
  pwaLoginEmailLabel: 'Email address',
  pwaLoginPushStep: 'Allow notifications so we can send your sign-in to this app after you confirm in email.',
  pwaLoginPushAlreadyGranted:
    'Notifications are already allowed on this device. Tap below to resend the sign-in email, or turn notifications off to start over.',
  pwaLoginResendEmail: 'Resend sign-in email',
  pwaLoginTurnOffNotifications: 'Turn off notifications',
  pwaLoginAllowNotifications: 'Allow notifications',
  pwaLoginWorking: 'Working…',
  pwaLoginPushDenied:
    'Push notifications are required for this sign-in method. Try signing in through Safari first, then open the app — or use the regular email form below.',
  pwaLoginCheckEmail: 'Check your email. Tap the link to continue.',
  pwaLoginCheckEmailHint:
    'When prompted in Safari, choose to sign into the Home Screen app. Then switch back here — you should be signed in automatically.',
  pwaLoginStepOf: (step: number, total: number) => `Step ${step} of ${total}`,
  pwaLoginUseRegularSignIn: 'Use regular sign-in instead',
  pwaLoginDone: 'Done',
  pwaLoginErrorGeneric: 'Something went wrong',
  pwaLoginTurnOffFailed: 'Could not turn off notifications',
  pwaLoginPushNotConfigured: 'Push is not configured on the server',
  pwaLoginEmailSendFailed: 'We could not send the sign-in email. Please try again.',

  close: 'Close',
  continue: 'Continue',
  saving: 'Saving…',
  done: 'Done',

  authVerifyPwaPushTitle: 'Are you signing into the app on your home screen?',
  authVerifyPwaPushSending: 'Sending…',
  authVerifyPwaPushYes: 'Yes, sign me into the app',
  authVerifyPwaPushNo: 'No, sign in here instead',
  authVerifyPwaPushDone: 'Done! Switch back to the VMP app on your Home Screen.',
  authVerifyPwaPushDoneHint:
    'Tap the sign-in notification if you see it. If you are not signed in yet, close the app completely and open it again from your Home Screen.',
  authVerifyPwaPushDeliverFailed: 'We could not send the sign-in to your app. You can sign in in Safari instead.',
  authVerifyPwaPushAttemptNotFound: 'The login session expired. Please start again in the app.',
  authVerifyPwaPushNoPushSubscription: 'Push subscription not found. Please start again in the app.',
  authVerifyPwaPushPushFailed: 'Could not reach the app. Make sure it is installed and try again.',

  // ── Two-factor authentication ──────────────────────────────────────────────
  totpVerifyTitle: 'Two-factor authentication',
  totpVerifyIntro: 'Enter the 6-digit code from your authenticator app.',
  totpVerifyCodeLabel: 'Authenticator code',
  totpVerifyButton: 'Verify',
  totpVerifying: 'Verifying…',
  totpCodePlaceholder: '000000',
  totpSessionExpired: 'Your sign-in session has expired. Please start again.',
  totpBackToSignIn: 'Back to sign in',
  totpLostAuthenticator: 'Lost access to your authenticator?',
  totpContactSupport: 'Contact support',
  totpInvalidCode: 'Invalid code. Please try again.',
  totpVerificationFailed: 'Verification failed',
  totpPwaSessionExpired: 'Sign-in session expired. Open the link from your email again.',

  totpSetupTitle: 'Set up two-factor authentication',
  totpSetupIntroAdminGate:
    'You need two-factor authentication before you can open the admin area. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.), then enter the code to confirm.',
  totpSetupIntroStaffRequired:
    'Your role requires two-factor authentication to access the admin area. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.), then enter the code to confirm.',
  totpSetupIntroOptional:
    'Add an extra layer of security to your account. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.), then enter the code to confirm.',
  totpSetupGenerating: 'Generating your secret…',
  totpSetupTryAgain: 'Try again',
  totpSetupBackToAccount: 'Back to account',
  totpSetupManualEntry: "Can't scan? Enter this code manually:",
  totpSetupConfirmLabel: 'Enter the 6-digit code to confirm',
  totpSetupEnableButton: 'Enable two-factor authentication',
  totpSetupConfirming: 'Confirming…',
  totpSetupEnabledTitle: '2FA enabled',
  totpSetupEnabledBody: 'Your account is now protected. Redirecting…',
  totpSetupAlreadyEnabled: 'Two-factor authentication is already enabled. Disable it from your account page to set up a new authenticator.',
  totpSetupFailedLoad: 'Failed to load setup. Please refresh.',
  totpSetupLoadFailed: 'Failed to load setup',
  totpSetupConfirmationFailed: 'Confirmation failed',

  totpAccountSectionTitle: 'Two-factor authentication',
  totpAccountEnabledBadge: 'Enabled',
  totpAccountEnabled:
    'Your account is protected with an authenticator app. To switch devices, turn off 2FA below and set it up again.',
  totpAccountSetupRequiredBadge: 'Setup required',
  totpAccountSetupRequired: 'Your role requires 2FA to access the admin area.',
  totpAccountOptionalBlurb: 'Add extra security to your account (optional).',
  totpAccountSetupButton: 'Set up two-factor authentication',
  totpAccountDisableButton: 'Turn off two-factor authentication',
  totpAccountDisableHintStaff:
    'You can turn off 2FA here, but you must set it up again before you can open the admin area.',
  totpAccountDisableHintOptional: 'You can turn it back on anytime from this page.',
  totpAccountDisablePrompt: 'Enter your current 6-digit code to turn off 2FA.',
  totpAccountDisabling: 'Disabling…',
  totpAccountDisableFailed: 'Could not disable 2FA',

  // ── Homepage ───────────────────────────────────────────────────────────────
  heroTitleDefault: 'Discover Premium Video Content',
  heroSubtitleDefault: 'Watch free previews or unlock full access with a premium subscription',
  loadingVideos: 'Loading videos...',
  errorLoadingVideos: 'Error Loading Videos',
  failedToLoadVideos: 'Failed to load videos',
  noVideosTitle: 'No Videos Yet',
  noVideosSubtitle: 'Check back soon for new content',
  recentVideos: 'Recent videos',
  allUncategorized: 'All uncategorized videos',
  availableVideos: 'Available Videos',
  moreInCategory: (n: number) => `+${n} more in this category`,
  categoryMoreLink: 'More →',
  openGraph: 'Open graph',
  dismiss: 'Dismiss',

  // ── Category page ──────────────────────────────────────────────────────────
  categoryDefaultName: 'Category',
  categoryVideosCount: (n: number) => `${n} videos`,
  categoryEmpty: 'No published videos in this category yet.',
  categoryPrevious: 'Previous',
  categoryNext: 'Next',
  categoryPage: (n: number) => `Page ${n}`,
  categoryLoadFailed: 'Failed to load category',
  categorySeoVideosIn: (count: number, name: string) => `${count} videos in ${name}`,
  categorySeoVideosInName: (name: string) => `Videos in ${name}`,

  // ── Watch page ─────────────────────────────────────────────────────────────
  loadingVideo: 'Loading video...',
  noDescription: 'No description available.',
  previewMode: 'Preview Mode',
  upgradeToWatch: 'Upgrade to watch full video',
  premiumAccess: 'Premium Access',
  freeToWatch: 'Free to watch',
  previewOnly: (duration: string) => `Preview Only (${duration})`,
  upNext: 'Up Next',
  videoBuffering: 'Video is buffering',
  playVideo: 'Play video',
  pauseVideo: 'Pause',
  mute: 'Mute',
  unmute: 'Unmute',
  live: 'Live',
  goToLive: 'Go to live',
  fullscreen: 'Fullscreen',
  volume: 'Volume',
  playbackSpeed: 'Playback speed',
  readMore: 'More',
  readLess: 'Less',
  seekTimeline: 'Seek timeline',
  videoPlaybackError: 'Video playback error. The HLS stream could not be loaded.',
  livestreamUnavailable: 'Livestream feed unavailable',
  livestreamUnavailableDetail:
    'The stream is not currently connected. Add MoQ endpoint and broadcast in admin, or attach a recording.',
  liveBrowserOnly: 'Livestream playback is only available in the browser.',
  videoLoadFailed: 'Failed to load video data',
  rateLimitExceeded: 'Too many requests. Please try again later.',
  mediaFailedToLoad: 'Media failed to load',
  liveCanvasUnavailable: 'Live canvas is unavailable',
  videoElementUnavailable: 'Video element is unavailable',

  // ── Rate limit ─────────────────────────────────────────────────────────────
  rateLimitTitle: 'Free preview limit reached',
  rateLimitMessage: (current: number, limit: number) =>
    `You've watched ${current} of ${limit} free previews this hour. Sign in for unlimited previews — it's free.`,
  rateLimitWait: (time: string) => `Or wait ${time} for your limit to reset.`,

  // ── Account / billing ──────────────────────────────────────────────────────
  yourAccount: 'Your account',
  currentPlan: 'Current plan',
  providerLabel: 'Provider',
  manageSubscription: 'Manage subscription',
  openingPortal: 'Opening…',
  subscribedWelcome: "You're now subscribed!",
  subscribedWelcomeDetail: 'Welcome to VMP Premium. Enjoy unlimited access to all content.',
  renewsOn: 'Renews on',
  accessUntil: 'Access until',
  planMonthly: 'Monthly',
  planYearly: 'Yearly',
  planClub: 'Klubové predplatné',
  providerStripe: 'Stripe',
  providerGoCardless: 'GoCardless',
  billingPortalFailed: 'Could not open billing portal. Please try again.',
  networkError: 'Network error. Please try again.',
  gocardlessOpening: 'Opening GoCardless…',
  gocardlessRetrySetup: 'Retry bank setup',
  gocardlessContinueSetup: 'Continue bank setup',
  gocardlessRetryBanner: 'Your bank setup was not completed. You can retry with your account email prefilled.',
  gocardlessCheckoutFailed: 'Could not resume GoCardless checkout.',
  gocardlessFinalizeFailed: 'Could not finalize GoCardless checkout.',
  gocardlessFinalizeNetworkError: 'Network error while finalizing GoCardless checkout.',

  podcastRssTitle: 'Podcast RSS',
  podcastRssIntro: 'Use your personal URL in your podcast app for full episodes while subscribed.',
  podcastRssPersonalLabel: 'Your personal URL',
  copy: 'Copy',
  copied: 'Copied',
  rssLoadFailed: 'Could not load RSS URLs.',
  rssLoadNetworkError: 'Network error while loading RSS URLs.',
  copyFailed: 'Could not copy to clipboard. You can copy manually from the field.',

  // ── Subscription checkout ──────────────────────────────────────────────────
  checkoutPremiumTitle: 'Premium Content',
  checkoutPremiumSubtitle: 'Unlock the full video and all exclusive content.',
  checkoutPlanMonthly: 'Monthly',
  checkoutPlanYearly: 'Yearly',
  checkoutPlanClub: 'Club',
  checkoutPerMonth: 'per month',
  checkoutPerYear: 'per year',
  checkoutMostPopular: 'Most popular',
  checkoutPricesLoadFailed: 'Could not load pricing. Please refresh the page.',
  checkoutRedirecting: 'Redirecting to checkout…',
  checkoutPayWithBank: (price: string) => `Pay ${price} with your bank account`,
  checkoutPayByCard: 'Pay by card',
  checkoutPayByCardHint: 'Card, PayPal, or SEPA Direct Debit',
  checkoutMorePaymentMethods: 'More payment methods',
  checkoutHidePaymentMethods: 'Hide',
  checkoutSubscribeWithCard: 'Subscribe',
  checkoutStripeLoading: 'Loading secure checkout…',
  checkoutStripeProcessing: 'Processing…',
  checkoutStripeNotConfigured: 'Card payments are not configured.',
  checkoutStripeSdkUnavailable: 'Stripe checkout could not be loaded. Please refresh and try again.',
  checkoutStripeIncomplete: 'Payment was not completed. Please try again.',
  checkoutBlurbEmbedded: 'Pay with Apple Pay, Google Pay, card, PayPal, or bank debit. Cancel any time.',
  checkoutBlurbDefault: 'Secure checkout. Cancel any time.',
  checkoutBlurbStripe: 'Secure checkout. Cancel any time.',
  checkoutBlurbGoCardless: 'Secure checkout with your bank account. Cancel any time.',
  checkoutBlurbBoth: 'Secure checkout. Cancel any time.',
  checkoutStartFailed: 'Could not start checkout. Please try again.',
  checkoutSignInBefore: 'You will be asked to sign in before checkout.',
  checkoutPromoLabel: 'Promo code',
  checkoutPromoPlaceholder: 'e.g. STUDENT2026',
  checkoutPromoChecking: 'Checking…',
  checkoutPromoApply: 'Apply',
  checkoutPromoClear: 'Clear',
  checkoutPromoSignIn: 'Please sign in to validate promo codes.',
  checkoutPromoInvalid: 'Promo code is not valid.',
  checkoutPromoApplied: (code: string, reward: string) => `Promo applied: ${code} · ${reward}`,
  checkoutPromoValidateNetworkError: 'Network error while validating promo code.',
  premiumOverlayClose: 'Close subscription popup',

  // ── PWA ────────────────────────────────────────────────────────────────────
  pwaInstallPrompt: 'Install the app for quick access to your videos.',
  pwaInstall: 'Install',

  // ── Premium badge ──────────────────────────────────────────────────────────
  premiumBadge: 'PREMIUM',
  proBadge: 'PRO',

  // ── PWA push login (composable errors) ─────────────────────────────────────
  pwaPushStartFailed: 'Could not start sign-in',
  pwaPushRegisterFailed: 'Could not register for sign-in',
  pwaPushDeliverFailed: 'Could not deliver sign-in to the app',

  // ── Misc ───────────────────────────────────────────────────────────────────
  backToHomepage: '← Back to homepage',
  error: 'Error',

  /** Plan display names (admin_settings may override via API later). */
  planDisplayName(planType: string): string {
    const names: Record<string, string> = {
      monthly: 'Monthly',
      yearly: 'Yearly',
      club: 'Klubové predplatné',
    }
    return names[planType] ?? planType
  },

  paymentProviderLabel(provider: string): string {
    if (provider === 'gocardless') return 'GoCardless'
    if (provider === 'stripe') return 'Stripe'
    return provider
  },

  roleLabel(role: string | undefined): string {
    const labels: Record<string, string> = {
      super_admin: 'Owner',
      admin: 'Admin',
      editor: 'Editor',
      analyst: 'Analyst',
      moderator: 'Mod',
      viewer: 'Viewer',
    }
    return labels[role ?? ''] ?? 'Viewer'
  },

  /**
   * Admin dashboard copy inventory (not yet wired through admin/index.vue).
   * Keys mirror UI sections for translation tooling.
   */
  admin: {
    title: 'Admin Console',
    subtitle: 'Homepage curation + uploader controls in one place.',
    homepageUnsaved: 'Unsaved homepage changes',
    homepageSynced: 'Homepage synced',
    reload: 'Reload',
    saveChanges: 'Save changes',
    saving: 'Saving...',
    tablistAria: 'Admin sections',
    tabs: {
      videos: 'Videos',
      categories: 'Categories',
      homepage: 'Homepage',
      pills: 'Pills',
      notifications: 'Notifications',
      newsletter: 'Newsletter',
      users: 'Users & roles',
      analytics: 'Analytics',
      system: 'System',
    },
    newsletterAdminOnly:
      'Only site administrators can configure Brevo and send newsletter campaigns. Editors can use other admin tabs.',
    slotEmpty: (n: number) => `Slot ${n}`,
    noVideoSelected: 'No video selected',
    blockTitlePlaceholder: 'Block title',
    blockCopyPlaceholder: 'Block copy',
    childBlockTitlePlaceholder: 'Child block title',
    childBlockCopyPlaceholder: 'Child block copy',
    sideMini: 'Side mini',
    videoTitlePlaceholder: 'Video title',
    videoDescriptionPlaceholder: 'Description (optional)',
    uploadTranscode: 'Upload & transcode',
    uploading: 'Uploading…',
    replaceThumbnail: 'Replace thumbnail',
    uploadThumbnail: 'Upload thumbnail',
    rename: 'Rename',
    editSlug: 'Edit slug',
    openWatchPage: 'Open watch page',
    editLegacySlug: 'Edit legacy slug redirect',
    openLegacyUrl: 'Open legacy URL',
    editDescription: 'Edit description',
    sendPush: 'Send push notification to all subscribers',
    sendingPush: 'Sending…',
    swapWithDraft: 'Swap this published video with a draft',
    trash: 'Trash',
    deleting: 'Deleting…',
    categoryNamePlaceholder: 'Name',
    categorySlugPlaceholder: 'slug-name',
    categorySortPlaceholder: 'Sort order',
    moveCategoryUp: 'Move category up',
    moveCategoryDown: 'Move category down',
    pillsApiKeyPlaceholder: 'Enter new API key',
    pillLabelPlaceholder: 'Label',
    pillValuePlaceholder: 'Value',
    pillColorPlaceholder: '#2563eb',
    pillDisagreePlaceholder: 'Disagree value',
    pillEmbedUrlPlaceholder: 'Flourish/embed URL',
    pillImageUrlPlaceholder: 'Image URL (optional)',
    filterPlaceholder: 'Filter…',
    superAdminOnlyEdit: 'Only a super admin may change this account',
  },
} as const

export type Strings = typeof strings

export default strings

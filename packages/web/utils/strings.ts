/**
 * Centralized viewer-facing strings.
 *
 * All user-visible copy that appears on the homepage, watch page, account page,
 * header, and other public surfaces lives here. This makes it straightforward
 * to customise or translate the project without hunting through SFCs.
 *
 * Admin-only copy (dashboard labels, toast messages) is intentionally excluded
 * — those strings are tightly coupled to admin UI and rarely translated.
 */

const strings = {
  // ── Site-wide ──────────────────────────────────────────────────────────────
  siteName: 'Video Monetization Platform',
  siteNameShort: 'VMP',
  siteDescription: 'Premium video content platform',

  // ── Header ─────────────────────────────────────────────────────────────────
  signIn: 'Sign in',
  signOut: 'Sign out',
  accountMenu: 'Open account menu',
  signedInAs: 'Signed in as',
  adminConsole: 'Admin console',
  account: 'Account',
  enableNotifications: 'Enable notifications',
  disableNotifications: 'Disable notifications',
  notificationsBlocked: 'Notifications blocked by browser',
  notificationsOn: 'Notifications on — click to disable',
  notificationsClickEnable: 'Click to enable new video notifications',
  notificationsUnsupportedContext: 'Notifications are unavailable in this browser context.',
  notificationsUnsupportedIosSafari: 'On iPhone/iPad, add this site to your Home Screen and open it as an installed web app to enable notifications.',
  notificationsUnsupportedSafari: 'This Safari context does not currently support web push for this app.',
  notificationsEnabled: 'Notifications enabled.',
  notificationsTurnedOff: 'Notifications turned off.',

  // ── Magic link / PWA handoff (auth/verify) ────────────────────────────────
  authVerifySigningIn: 'Signing you in…',
  authVerifyHandoffTitle: 'Open the VMP app',
  authVerifyHandoffBody:
    'On iPhone and iPad, the app you added to your Home Screen is separate from Safari. Open VMP from your Home Screen and the app will attempt to finish signing in. If it doesn\'t complete, return to Safari and use the button below.',
  authVerifyHandoffContinueSafari: 'Continue in Safari',
  authVerifyHandoffCopyLink: 'Copy sign-in link',
  authVerifyHandoffCopied: 'Link copied',

  pwaLoginTitle: 'Sign in to the app',
  pwaLoginIntro: 'This takes a few extra steps the first time. Follow each step carefully.',
  pwaLoginPushStep: 'Allow notifications so we can send your sign-in to this app after you confirm in email.',
  pwaLoginPushAlreadyGranted:
    'Notifications are already allowed on this device. Tap below to resend the sign-in email, or turn notifications off to start over.',
  pwaLoginResendEmail: 'Resend sign-in email',
  pwaLoginTurnOffNotifications: 'Turn off notifications',
  pwaLoginPushDenied:
    'Push notifications are required for this sign-in method. Try signing in through Safari first, then open the app — or use the regular email form below.',
  pwaLoginCheckEmail: 'Check your email. Tap the link to continue.',
  pwaLoginCheckEmailHint: 'When prompted in Safari, choose to sign into the Home Screen app. Then switch back here — you should be signed in automatically.',

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

  // ── Login (magic link) ─────────────────────────────────────────────────────
  loginTitle: 'Sign in',
  loginSubtitle: "We'll email you a sign-in link. No password needed.",
  loginEmailLabel: 'Email address',
  loginSendLink: 'Send sign-in link',
  loginSending: 'Sending…',
  loginMagicLinkSent: '✓ Check your inbox — a sign-in link is on its way.',
  loginMagicLinkExpires: 'It expires in 15 minutes.',
  loginOpenEmailApp: 'Open your email app',
  loginOpenGmail: 'Gmail',
  loginOpenOutlook: 'Outlook',
  loginOpenEmailHint: 'Use your default mail app, or open webmail in a new tab.',

  // ── Two-factor authentication ────────────────────────────────────────────
  totpSetupTitle: 'Set up two-factor authentication',
  totpSetupIntroAdminGate:
    'You need two-factor authentication before you can open the admin area. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.), then enter the code to confirm.',
  totpSetupIntroStaffRequired:
    'Your role requires two-factor authentication to access the admin area. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.), then enter the code to confirm.',
  totpSetupIntroOptional:
    'Add an extra layer of security to your account. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.), then enter the code to confirm.',
  totpSetupManualEntry: "Can't scan? Enter this code manually:",
  totpSetupConfirmLabel: 'Enter the 6-digit code to confirm',
  totpSetupEnableButton: 'Enable two-factor authentication',
  totpSetupConfirming: 'Confirming…',
  totpSetupEnabledTitle: '2FA enabled',
  totpSetupEnabledBody: 'Your account is now protected. Redirecting…',
  totpSetupAlreadyEnabled: 'Two-factor authentication is already enabled. Disable it from your account page to set up a new authenticator.',
  totpAccountSectionTitle: 'Two-factor authentication',
  totpAccountEnabled: 'Your account is protected with an authenticator app. To switch devices, turn off 2FA below and set it up again.',
  totpAccountSetupRequired: 'Your role requires 2FA to access the admin area.',
  totpAccountOptionalBlurb: 'Add extra security to your account (optional).',
  totpAccountSetupButton: 'Set up two-factor authentication',
  totpAccountDisableButton: 'Turn off two-factor authentication',
  totpAccountDisableHintStaff:
    'You can turn off 2FA here, but you must set it up again before you can open the admin area.',
  totpAccountDisableHintOptional: 'You can turn it back on anytime from this page.',
  totpAccountDisablePrompt: 'Enter your current 6-digit code to turn off 2FA.',
  totpAccountDisabling: 'Disabling…',

  // ── Homepage ───────────────────────────────────────────────────────────────
  heroTitleDefault: 'Discover Premium Video Content',
  heroSubtitleDefault: 'Watch free previews or unlock full access with a premium subscription',
  loadingVideos: 'Loading videos...',
  errorLoadingVideos: 'Error Loading Videos',
  noVideosTitle: 'No Videos Yet',
  noVideosSubtitle: 'Check back soon for new content',
  recentVideos: 'Recent videos',
  allUncategorized: 'All uncategorized videos',
  availableVideos: 'Available Videos',
  moreInCategory: (n: number) => `+${n} more in this category`,
  categoryMoreLink: 'More →',

  // ── Watch page ─────────────────────────────────────────────────────────────
  loadingVideo: 'Loading video...',
  noDescription: 'No description available.',
  previewMode: 'Preview Mode',
  upgradeToWatch: 'Upgrade to watch full video',
  premiumAccess: 'Premium Access',
  /** Shown when the full video is unlocked for anonymous viewers (preview lock = full duration). */
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
  videoPlaybackError: 'Video playback error. The HLS stream could not be loaded.',
  livestreamUnavailable: 'Livestream feed unavailable',
  livestreamUnavailableDetail: 'The stream is not currently connected. Attach a recording or update the livestream playback URL in admin.',

  // ── Rate limit ─────────────────────────────────────────────────────────────
  rateLimitTitle: 'Free preview limit reached',
  rateLimitMessage: (current: number, limit: number) =>
    `You've watched ${current} of ${limit} free previews this hour. Sign in for unlimited previews — it's free.`,
  rateLimitWait: (time: string) => `Or wait ${time} for your limit to reset.`,

  // ── Account page ───────────────────────────────────────────────────────────
  yourAccount: 'Your account',
  currentPlan: 'Current plan',
  manageSubscription: 'Manage subscription',
  subscribedWelcome: "You're now subscribed!",
  subscribedWelcomeDetail: 'Welcome to VMP Premium. Enjoy unlimited access to all content.',
  renewsOn: 'Renews on',
  accessUntil: 'Access until',

  // ── PWA ────────────────────────────────────────────────────────────────────
  pwaInstallPrompt: 'Install the app for quick access to your videos.',
  pwaInstall: 'Install',

  // ── Premium badge ──────────────────────────────────────────────────────────
  premiumBadge: 'PREMIUM',
  proBadge: 'PRO',

  // ── Misc ───────────────────────────────────────────────────────────────────
  backToHomepage: '← Back to homepage',
  error: 'Error',
}

export default strings

export type UiLocale = 'en' | 'sk' | 'cs'

export type PlanType = 'monthly' | 'yearly' | 'club'
export type PaymentProvider = 'stripe' | 'legacy'

export type PersonalDataSection = {
  id: string
  title: string
  paragraphs: string[]
  bullets?: string[]
}

export type PersonalDataStorageRow = {
  name: string
  mechanism: string
  purpose: string
  lifetime: string
  necessary: string
}

export type PersonalDataPage = {
  metaTitle: string
  metaDescription: string
  intro: readonly string[]
  bannerSummary: string
  sections: readonly PersonalDataSection[]
  storageRows: readonly PersonalDataStorageRow[]
}

/** Viewer + admin inventory strings without locale helper methods. */
export type StringsDefinition = {
  siteName: string
  siteNameShort: string
  siteDescription: string
  signIn: string
  signOut: string
  accountMenu: string
  signedInAs: string
  adminConsole: string
  account: string
  enableNotifications: string
  disableNotifications: string
  notificationsBlocked: string
  notificationsBlockedSettings: string
  notificationsOn: string
  notificationsClickEnable: string
  notificationsUnsupportedContext: string
  notificationsUnsupportedIosSafari: string
  notificationsUnsupportedSafari: string
  notificationsEnabled: string
  notificationsTurnedOff: string
  notificationsBrowserBlocked: string
  notificationsNotConfigured: string
  notificationsEnableFailed: string
  notificationsUnsubscribeSyncFailed: string
  serverError: string
  roleSuperAdmin: string
  roleAdmin: string
  roleEditor: string
  roleAnalyst: string
  roleModerator: string
  roleViewer: string
  loginTitle: string
  loginSubtitle: string
  loginEmailLabel: string
  loginEmailPlaceholder: string
  loginSendLink: string
  loginSending: string
  loginMagicLinkSent: string
  loginMagicLinkExpires: string
  loginSessionFlowHint: string
  loginOpenEmailApp: string
  loginOpenGmail: string
  loginOpenOutlook: string
  loginOpenEmailHint: string
  loginTerms: string
  loginErrorGeneric: string
  authVerifySigningIn: string
  authVerifyHandoffTitle: string
  authVerifyHandoffBody: string
  authVerifyHandoffContinueSafari: string
  authVerifyHandoffCopyLink: string
  authVerifyHandoffCopied: string
  authVerifyErrorGeneric: string
  authVerifySignInIncomplete: string
  authVerifyNoToken: string
  pwaLoginTitle: string
  pwaLoginIntro: string
  pwaLoginEmailLabel: string
  pwaLoginPushStep: string
  pwaLoginPushAlreadyGranted: string
  pwaLoginResendEmail: string
  pwaLoginTurnOffNotifications: string
  pwaLoginAllowNotifications: string
  pwaLoginWorking: string
  pwaLoginPushDenied: string
  pwaLoginCheckEmail: string
  pwaLoginCheckEmailHint: string
  pwaLoginStepOf: (step: number, total: number) => string
  pwaLoginUseRegularSignIn: string
  pwaLoginDone: string
  pwaLoginErrorGeneric: string
  pwaLoginTurnOffFailed: string
  pwaLoginPushNotConfigured: string
  pwaLoginEmailSendFailed: string
  close: string
  continue: string
  saving: string
  done: string
  authVerifyPwaPushTitle: string
  authVerifyPwaPushSending: string
  authVerifyPwaPushYes: string
  authVerifyPwaPushNo: string
  authVerifyPwaPushDone: string
  authVerifyPwaPushDoneHint: string
  authVerifyPwaPushDeliverFailed: string
  authVerifyPwaPushAttemptNotFound: string
  authVerifyPwaPushNoPushSubscription: string
  authVerifyPwaPushPushFailed: string
  totpVerifyTitle: string
  totpVerifyIntro: string
  totpVerifyCodeLabel: string
  totpVerifyButton: string
  totpVerifying: string
  totpCodePlaceholder: string
  totpSessionExpired: string
  totpBackToSignIn: string
  totpLostAuthenticator: string
  totpContactSupport: string
  totpInvalidCode: string
  totpVerificationFailed: string
  totpPwaSessionExpired: string
  totpSetupTitle: string
  totpSetupIntroAdminGate: string
  totpSetupIntroStaffRequired: string
  totpSetupIntroOptional: string
  totpSetupGenerating: string
  totpSetupTryAgain: string
  totpSetupBackToAccount: string
  totpSetupManualEntry: string
  totpSetupConfirmLabel: string
  totpSetupEnableButton: string
  totpSetupConfirming: string
  totpSetupEnabledTitle: string
  totpSetupEnabledBody: string
  totpSetupAlreadyEnabled: string
  totpSetupFailedLoad: string
  totpSetupLoadFailed: string
  totpSetupConfirmationFailed: string
  totpAccountSectionTitle: string
  totpAccountEnabledBadge: string
  totpAccountEnabled: string
  totpAccountSetupRequiredBadge: string
  totpAccountSetupRequired: string
  totpAccountOptionalBlurb: string
  totpAccountSetupButton: string
  totpAccountDisableButton: string
  totpAccountDisableHintStaff: string
  totpAccountDisableHintOptional: string
  totpAccountDisablePrompt: string
  totpAccountDisabling: string
  totpAccountDisableFailed: string
  heroTitleDefault: string
  heroSubtitleDefault: string
  loadingVideos: string
  errorLoadingVideos: string
  failedToLoadVideos: string
  noVideosTitle: string
  noVideosSubtitle: string
  recentVideos: string
  allUncategorized: string
  availableVideos: string
  moreInCategory: (n: number) => string
  categoryMoreLink: string
  openGraph: string
  dismiss: string
  categoryDefaultName: string
  categoryVideosCount: (n: number) => string
  categoryEmpty: string
  categoryPrevious: string
  categoryNext: string
  categoryPage: (n: number) => string
  categoryLoadFailed: string
  categorySeoVideosIn: (count: number, name: string) => string
  categorySeoVideosInName: (name: string) => string
  loadingVideo: string
  noDescription: string
  previewMode: string
  upgradeToWatch: string
  premiumAccess: string
  freeToWatch: string
  previewOnly: (duration: string) => string
  upNext: string
  videoBuffering: string
  playVideo: string
  pauseVideo: string
  mute: string
  unmute: string
  live: string
  goToLive: string
  fullscreen: string
  enterFullscreen: string
  exitFullscreen: string
  settings: string
  startAirPlay: string
  volume: string
  playbackSpeed: string
  readMore: string
  readLess: string
  seekTimeline: string
  videoPlaybackError: string
  livestreamUnavailable: string
  livestreamUnavailableDetail: string
  liveBrowserOnly: string
  videoLoadFailed: string
  rateLimitExceeded: string
  mediaFailedToLoad: string
  liveCanvasUnavailable: string
  videoElementUnavailable: string
  rateLimitTitle: string
  rateLimitMessage: (current: number, limit: number) => string
  rateLimitWait: (time: string) => string
  yourAccount: string
  currentPlan: string
  providerLabel: string
  manageSubscription: string
  openingPortal: string
  subscribedWelcome: string
  subscribedWelcomeDetail: string
  renewsOn: string
  accessUntil: string
  planMonthly: string
  planYearly: string
  planClub: string
  providerStripe: string
  billingPortalFailed: string
  accountContactSupport: string
  accountRelinkPaymentMethod: string
  accountManagePaymentMethod: string
  networkError: string
  podcastRssTitle: string
  podcastRssIntro: string
  podcastRssPersonalLabel: string
  copy: string
  copied: string
  rssLoadFailed: string
  rssLoadNetworkError: string
  copyFailed: string
  checkoutPremiumTitle: string
  checkoutPremiumSubtitle: string
  checkoutPlanMonthly: string
  checkoutPlanYearly: string
  checkoutPlanClub: string
  checkoutPerMonth: string
  checkoutPerYear: string
  checkoutMostPopular: string
  checkoutPricesLoadFailed: string
  checkoutRedirecting: string
  checkoutPayWithBank: (price: string) => string
  checkoutPayByCard: string
  checkoutPayByCardHint: string
  checkoutMorePaymentMethods: string
  checkoutHidePaymentMethods: string
  checkoutSubscribeWithCard: string
  checkoutStripeLoading: string
  checkoutStripeProcessing: string
  checkoutStripeNotConfigured: string
  checkoutStripeSdkUnavailable: string
  checkoutStripeIncomplete: string
  checkoutBlurbEmbedded: string
  checkoutBlurbDefault: string
  checkoutBlurbStripe: string
  checkoutBlurbBoth: string
  checkoutStartFailed: string
  checkoutSignInBefore: string
  checkoutPromoLabel: string
  checkoutPromoPlaceholder: string
  checkoutPromoChecking: string
  checkoutPromoApply: string
  checkoutPromoClear: string
  checkoutPromoSignIn: string
  checkoutPromoInvalid: string
  checkoutPromoApplied: (code: string, reward: string) => string
  checkoutPromoValidateNetworkError: string
  premiumOverlayClose: string
  personalDataPageTitle: string
  personalDataBannerSummary: string
  personalDataLearnMore: string
  personalDataBannerAcknowledge: string
  personalDataTableName: string
  personalDataTableMechanism: string
  personalDataTablePurpose: string
  personalDataTableLifetime: string
  personalDataTableNecessary: string
  pwaInstallPrompt: string
  pwaInstall: string
  premiumBadge: string
  proBadge: string
  pwaPushStartFailed: string
  pwaPushRegisterFailed: string
  pwaPushDeliverFailed: string
  backToHomepage: string
  error: string
  admin: {
    title: string
    subtitle: string
    homepageUnsaved: string
    homepageSynced: string
    reload: string
    saveChanges: string
    saving: string
    tablistAria: string
    tabs: {
      videos: string
      categories: string
      homepage: string
      pills: string
      notifications: string
      newsletter: string
      users: string
      analytics: string
      system: string
    }
    newsletterAdminOnly: string
    slotEmpty: (n: number) => string
    noVideoSelected: string
    blockTitlePlaceholder: string
    blockCopyPlaceholder: string
    childBlockTitlePlaceholder: string
    childBlockCopyPlaceholder: string
    sideMini: string
    videoTitlePlaceholder: string
    videoDescriptionPlaceholder: string
    uploadTranscode: string
    uploading: string
    replaceThumbnail: string
    uploadThumbnail: string
    rename: string
    editSlug: string
    openWatchPage: string
    editLegacySlug: string
    openLegacyUrl: string
    editDescription: string
    sendPush: string
    sendingPush: string
    swapWithDraft: string
    trash: string
    deleting: string
    categoryNamePlaceholder: string
    categorySlugPlaceholder: string
    categorySortPlaceholder: string
    moveCategoryUp: string
    moveCategoryDown: string
    pillsApiKeyPlaceholder: string
    pillLabelPlaceholder: string
    pillValuePlaceholder: string
    pillColorPlaceholder: string
    pillDisagreePlaceholder: string
    pillEmbedUrlPlaceholder: string
    pillImageUrlPlaceholder: string
    filterPlaceholder: string
    superAdminOnlyEdit: string
  }
}

export type Strings = StringsDefinition & {
  planDisplayName(planType: string): string
  paymentProviderLabel(provider: string): string
  roleLabel(role: string | undefined): string
}

export type LocaleCatalog = {
  locale: UiLocale
  htmlLang: string
  strings: Strings
  personalData: PersonalDataPage
}

import { hideAuthUrlCredentialsFromAddressBar } from '~/utils/authUrlCredentials';

export default defineNuxtPlugin({
  name: 'auth-url-credentials',
  enforce: 'pre',
  setup() {
    hideAuthUrlCredentialsFromAddressBar();
  },
});

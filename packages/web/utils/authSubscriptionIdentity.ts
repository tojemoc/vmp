export type AuthSubscriptionIdentity = {
  id: string;
  email: string;
};

export function shouldResetSubscriptionIdentity(
  previousUser: AuthSubscriptionIdentity | null,
  nextUser: AuthSubscriptionIdentity,
): boolean {
  if (!previousUser) return false;
  return previousUser.id !== nextUser.id || previousUser.email !== nextUser.email;
}

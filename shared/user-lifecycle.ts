export const userAccountStatuses = ['active', 'disabled', 'departed'] as const
export type UserAccountStatus = (typeof userAccountStatuses)[number]

export function isUserAccountStatus(value: unknown): value is UserAccountStatus {
  return userAccountStatuses.includes(value as UserAccountStatus)
}

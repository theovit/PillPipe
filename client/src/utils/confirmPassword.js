// Re-auth for destructive actions (restore, wipe, delete): the server requires the current app
// password in an X-Confirm-Password header. A plain prompt() matches this app's existing
// confirm()-dialog level of polish for these guard rails — a nicer modal can replace it later.
export function promptConfirmPassword() {
  const password = window.prompt('Enter your password to confirm this action:');
  return password?.trim() || null;
}

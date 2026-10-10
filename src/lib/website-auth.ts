export function websiteAuthConfigured() {
  return Boolean(
    (process.env.PUBLIC_CLERK_PUBLISHABLE_KEY || import.meta.env?.PUBLIC_CLERK_PUBLISHABLE_KEY)
    && (process.env.CLERK_SECRET_KEY || import.meta.env?.CLERK_SECRET_KEY),
  );
}

export function websiteCloudOwner(locals: App.Locals): string | null {
  if (!websiteAuthConfigured()) return null;
  const { isAuthenticated, userId } = locals.auth();
  return isAuthenticated && userId ? `clerk:${userId}` : null;
}

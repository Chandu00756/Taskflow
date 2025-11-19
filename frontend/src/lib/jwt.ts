// JWT token utilities for extracting user claims
// Human developer note: The API returns proto enum values (USER_ROLE_MEMBER) but the JWT contains actual role strings (super_admin, org_admin, member)
// We decode the JWT client-side to show the correct UI based on the user's real role

interface JWTPayload {
  role: string;           // Actual role from JWT: "super_admin", "org_admin", "member"
  user_id: string;        // User UUID
  org_id?: string;        // Organization UUID (empty for super admin)
  exp: number;            // Expiration timestamp
}

/**
 * Lightweight JWT payload parser (no validation) — used to extract claims client-side
 * WARNING: Never trust client-side JWT for security decisions! Backend must validate everything.
 * This is ONLY for UX purposes (showing admin UI, redirecting to correct page, etc)
 */
export function parseJwt(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    
    // Decode the payload (middle section of JWT)
    const payload = parts[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded as JWTPayload;
  } catch (e) {
    return null;
  }
}

/**
 * Extract user role from JWT token
 * Returns the ACTUAL role string from JWT (not the proto enum value from API)
 */
export function getRoleFromToken(token: string): string | null {
  const payload = parseJwt(token);
  return payload?.role || null;
}

/**
 * Check if JWT token is expired
 * Returns true if expired or invalid
 */
export function isTokenExpired(token: string): boolean {
  try {
    const payload = parseJwt(token);
    if (!payload?.exp) return true;
    
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now;
  } catch {
    return true;
  }
}

/**
 * Check if user is super admin (platform-wide administrator)
 * Super admin has access to all organizations and system settings
 */
export function isSuperAdmin(token: string): boolean {
  const role = getRoleFromToken(token);
  return role === 'super_admin';
}

/**
 * Check if user is organization admin
 * Org admin can manage their organization and invite members
 */
export function isOrgAdmin(token: string): boolean {
  const role = getRoleFromToken(token);
  return role === 'org_admin';
}

/**
 * Check if user has any admin privileges
 */
export function isAdmin(token: string): boolean {
  return isSuperAdmin(token) || isOrgAdmin(token);
}

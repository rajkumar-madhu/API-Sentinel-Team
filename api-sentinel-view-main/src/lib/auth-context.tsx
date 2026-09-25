import React, { createContext, useContext, useState, useEffect } from 'react';
import { post, get, setToken, ApiError } from './api-client';

function friendlyError(err: unknown, action: 'login' | 'signup'): string {
  if (err instanceof ApiError) {
    const body = err.body as {
      detail?: string | { msg: string }[];
      message?: string;
    } | null;
    if (typeof body?.detail === 'string') return body.detail;
    if (Array.isArray(body?.detail)) {
      return body!.detail.map((d: { msg: string }) => d.msg).join(', ');
    }
    // FastAPI JSON handlers in main.py use { error, message }
    if (typeof body?.message === 'string') return body.message;
    if (err.status === 401) return 'Incorrect email or password.';
    if (err.status === 409) return 'An account with this email already exists.';
    if (err.status === 422) return action === 'signup' ? 'Please fill all fields correctly.' : 'Invalid email or password format.';
    if (err.status === 429) return 'Too many attempts. Please wait a minute.';
  }
  return 'Network error - is the backend running?';
}

export type UserRole =
  | 'PLATFORM_ADMIN'
  | 'ADMIN'
  | 'SECURITY_ENGINEER'
  | 'DEVELOPER'
  | 'MEMBER'
  | 'AUDITOR'
  | 'VIEWER'
  // Tenant-defined role; backend RBAC enforces its actual permission set.
  | 'CUSTOM'
  | 'GUEST';

export type WorkspaceKey = 'customer' | 'admin' | 'platform';

export interface User {
  login: string;
  name?: string;
  role: UserRole;
  /** Name of the tenant-defined role when `role` is 'CUSTOM'. */
  customRoleName?: string;
  accounts?: Record<string, unknown>;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  role: UserRole;
  isTenantAdmin: boolean;
  canAccessCustomerWorkspace: boolean;
  canAccessAdminWorkspace: boolean;
  canAccessPlatformWorkspace: boolean;
  canAccessWorkspace: (workspace: WorkspaceKey) => boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  // signup derives account_name from email prefix
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const CUSTOMER_WORKSPACE_ROLES: UserRole[] = [
  'ADMIN',
  'SECURITY_ENGINEER',
  'DEVELOPER',
  'MEMBER',
  'AUDITOR',
  'VIEWER',
  'CUSTOM',
];

const ADMIN_WORKSPACE_ROLES: UserRole[] = [
  'ADMIN',
  'SECURITY_ENGINEER',
];

const PLATFORM_WORKSPACE_ROLES: UserRole[] = [
  'PLATFORM_ADMIN',
];

function normalizeRole(role?: string | null): UserRole {
  const normalized = role?.toUpperCase();
  switch (normalized) {
    case 'PLATFORM_ADMIN':
    case 'ADMIN':
    case 'SECURITY_ENGINEER':
    case 'DEVELOPER':
    case 'MEMBER':
    case 'AUDITOR':
    case 'VIEWER':
      return normalized;
    case 'GUEST':
    case undefined:
    case '':
      return 'GUEST';
    default:
      // Any other non-empty role is a tenant-defined custom role.
      return 'CUSTOM';
  }
}

function buildUserFromProfile(
  profile: { email?: string; role?: string; account_id?: number },
  defaultAccountName: string,
): User | null {
  if (!profile?.email) {
    return null;
  }

  const accounts = profile.account_id != null
    ? {
        [String(profile.account_id)]: {
          accountId: profile.account_id,
          name: defaultAccountName,
          isDefault: true,
        },
      }
    : {};

  const role = normalizeRole(profile.role);
  return {
    login: profile.email,
    name: profile.email.split('@')[0],
    role,
    customRoleName: role === 'CUSTOM' ? profile.role?.toUpperCase() : undefined,
    accounts,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    get<{ email?: string; role?: string; account_id?: number }>('/auth/me')
      .then(profile => {
        const nextUser = buildUserFromProfile(profile, 'My Org');
        if (nextUser) {
          setUser(nextUser);
        } else {
          setToken(null);
          setUser(null);
        }
      })
      .catch(() => { setToken(null); setUser(null); })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    try {
      // Session is the httpOnly cookie — never store JWT in JS memory.
      await post<{ role?: string }>('/auth/login', { email, password });
      setToken(null);
      const profile = await get<{ email?: string; role?: string; account_id?: number }>('/auth/me');
      const nextUser = buildUserFromProfile(profile, 'My Org');
      if (nextUser) {
        setUser(nextUser);
      }
    } catch (err) {
      throw new Error(friendlyError(err, 'login'));
    }
  };

  const signup = async (email: string, password: string) => {
    try {
      const accountName = email.split('@')[0] || 'My Org';
      await post<{ role?: string }>('/auth/signup', { email, password, account_name: accountName });
      setToken(null);
      const profile = await get<{ email?: string; role?: string; account_id?: number }>('/auth/me');
      const nextUser = buildUserFromProfile(profile, accountName);
      if (nextUser) {
        setUser(nextUser);
      }
    } catch (err) {
      throw new Error(friendlyError(err, 'signup'));
    }
  };
  const logout = async () => {
    try {
      await post('/auth/logout');
    } catch {
      // Clear the client session even if backend logout fails.
    }
    setToken(null);
    setUser(null);
    window.location.assign('/login');
  };

  const role = user ? normalizeRole(user.role) : 'GUEST';
  const isAdmin = role === 'ADMIN';
  const isTenantAdmin = ADMIN_WORKSPACE_ROLES.includes(role);
  const canAccessCustomerWorkspace = CUSTOMER_WORKSPACE_ROLES.includes(role) || isTenantAdmin;
  const canAccessAdminWorkspace = isTenantAdmin;
  const canAccessPlatformWorkspace = PLATFORM_WORKSPACE_ROLES.includes(role);
  const canAccessWorkspace = (workspace: WorkspaceKey) => {
    if (workspace === 'customer') {
      return canAccessCustomerWorkspace;
    }
    if (workspace === 'admin') {
      return canAccessAdminWorkspace;
    }
    return canAccessPlatformWorkspace;
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      error: null,
      isAdmin,
      role,
      isTenantAdmin,
      canAccessCustomerWorkspace,
      canAccessAdminWorkspace,
      canAccessPlatformWorkspace,
      canAccessWorkspace,
      login,
      signup,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

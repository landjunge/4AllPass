/**
 * Client-side authentication plumbing for 4AllPass.
 *
 * IMPORTANT:
 * Authentication !== Vault Decryption.
 *
 * This module manages account session authentication (session cookie via `credentials: "include"`).
 * It NEVER handles or stores the Master Password, Vault Key (VK), Device Key (DK), or plaintext entries.
 * Long-lived authentication credentials are not stored in localStorage.
 */

export interface UserProfile {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VaultMetadata {
  id: string;
  crypto_protocol_version: number;
  active_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceMetadata {
  id: string;
  device_id: string;
  display_name: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  webauthn_credentials: Array<{
    id: string;
    rp_id: string;
    prf_supported: boolean;
    large_blob_supported: boolean;
    user_verification: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }>;
  has_device_key_envelope: boolean;
}

const API_BASE = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Ensures HttpOnly session cookies are transmitted
  });

  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const data = await response.json();
      if (data && typeof data.detail === 'string') {
        errorDetail = data.detail;
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(errorDetail);
  }

  return response.json() as Promise<T>;
}

export async function register(email: string, password: string): Promise<UserProfile> {
  return request<UserProfile>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string): Promise<UserProfile> {
  return request<UserProfile>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/logout', {
    method: 'POST',
  });
}

export async function getMe(): Promise<UserProfile> {
  return request<UserProfile>('/auth/me', {
    method: 'GET',
  });
}

export async function createVault(cryptoProtocolVersion = 1): Promise<VaultMetadata> {
  return request<VaultMetadata>('/vaults', {
    method: 'POST',
    body: JSON.stringify({ crypto_protocol_version: cryptoProtocolVersion }),
  });
}

export async function listVaults(): Promise<VaultMetadata[]> {
  return request<VaultMetadata[]>('/vaults', {
    method: 'GET',
  });
}

export async function listDevices(vaultId: string): Promise<DeviceMetadata[]> {
  return request<DeviceMetadata[]>(`/vaults/${vaultId}/devices`, {
    method: 'GET',
  });
}

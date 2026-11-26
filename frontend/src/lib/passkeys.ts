/*
 * Browser side of passkeys (WebAuthn). The server sends options with binary
 * fields as base64url strings; these helpers turn them into ArrayBuffers for
 * navigator.credentials and turn the result back into JSON.
 */

type Json = Record<string, any>;

function b64urlToBuffer(value: string): ArrayBuffer {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufferToB64url(buf: ArrayBuffer | null | undefined): string | undefined {
  if (!buf) return undefined;
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const decodeList = (list?: Json[]) => list?.map((c) => ({ ...c, id: b64urlToBuffer(c.id) }));

/** True when this browser can use passkeys at all. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

/** Turns a browser WebAuthn error into something a person can act on. */
export function passkeyErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'The passkey request was cancelled or timed out. Try again.';
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account.';
  if (name === 'SecurityError') return 'Passkeys only work on the real TaskFlow address over HTTPS.';
  if (name === 'NotSupportedError') return 'This browser or device does not support passkeys.';
  return (e as Error)?.message || 'Something went wrong with the passkey.';
}

/** Runs navigator.credentials.create() with server options; returns JSON to send back. */
export async function createPasskey(options: Json): Promise<Json> {
  const pk = options.publicKey ?? options;
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...pk,
    challenge: b64urlToBuffer(pk.challenge),
    user: { ...pk.user, id: b64urlToBuffer(pk.user.id) },
    excludeCredentials: decodeList(pk.excludeCredentials),
  };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was created.');
  const res = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: (cred as any).authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: bufferToB64url(res.clientDataJSON),
      attestationObject: bufferToB64url(res.attestationObject),
      transports: typeof res.getTransports === 'function' ? res.getTransports() : undefined,
    },
  };
}

/** Runs navigator.credentials.get() with server options; returns JSON to send back. */
export async function signWithPasskey(options: Json): Promise<Json> {
  const pk = options.publicKey ?? options;
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...pk,
    challenge: b64urlToBuffer(pk.challenge),
    allowCredentials: decodeList(pk.allowCredentials),
  };
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was used.');
  const res = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: (cred as any).authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: bufferToB64url(res.clientDataJSON),
      authenticatorData: bufferToB64url(res.authenticatorData),
      signature: bufferToB64url(res.signature),
      userHandle: bufferToB64url(res.userHandle),
    },
  };
}

/** A friendly default name for a new passkey, from the browser and OS. */
export function defaultPasskeyName(): string {
  if (typeof navigator === 'undefined') return 'Passkey';
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${browser} on ${os}`;
}

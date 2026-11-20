export type PairingUrlStatus =
  | 'ready'
  | 'ais-dev-403'
  | 'localhost-only'
  | 'invalid';

export interface PairingUrlDiagnostics {
  normalizedOrigin: string | null;
  status: PairingUrlStatus;
  isAiStudioDevPreview: boolean;
  isSharedAppPreview: boolean;
  isLocalhostOnly: boolean;
  headline: string;
  explanation: string;
}

export function normalizeBaseOrigin(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function inspectPairingBaseUrl(
  rawUrl: string,
  options?: { sharedAppReachable?: boolean }
): PairingUrlDiagnostics {
  const normalizedOrigin = normalizeBaseOrigin(rawUrl);
  if (!normalizedOrigin) {
    return {
      normalizedOrigin: null,
      status: 'invalid',
      isAiStudioDevPreview: false,
      isSharedAppPreview: false,
      isLocalhostOnly: false,
      headline: 'Invalid Server URL',
      explanation: 'Enter a valid http:// or https:// base URL before scanning the QR code.',
    };
  }

  const hostname = new URL(normalizedOrigin).hostname.toLowerCase();
  const isAiStudioDevPreview = hostname.startsWith('ais-dev-');
  const isSharedAppPreview = hostname.startsWith('ais-pre-');
  const isLocalhostOnly =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (isAiStudioDevPreview) {
    return {
      normalizedOrigin,
      status: 'ais-dev-403',
      isAiStudioDevPreview: true,
      isSharedAppPreview: false,
      isLocalhostOnly: false,
      headline: 'Phone camera QR scan gets HTTP 403 on ais-dev- preview URLs',
      explanation: options?.sharedAppReachable
        ? 'Your Shared App URL (ais-pre-) is live and reachable without 403. Open the Shared App URL to mint & scan QR codes from any phone camera.'
        : 'Google AI Studio ais-dev- URLs require your active developer session and block external phone cameras with 403 Forbidden. Use one of the valid pairing options below.',
    };
  }

  if (isLocalhostOnly) {
    return {
      normalizedOrigin,
      status: 'localhost-only',
      isAiStudioDevPreview: false,
      isSharedAppPreview: false,
      isLocalhostOnly: true,
      headline: 'localhost cannot be reached from an external phone',
      explanation:
        'Scanning a localhost QR code on a phone points to the phone itself. Select a LAN IP (http://192.168.x.x:3000) or public HTTPS URL.',
    };
  }

  return {
    normalizedOrigin,
    status: 'ready',
    isAiStudioDevPreview: false,
    isSharedAppPreview,
    isLocalhostOnly: false,
    headline: isSharedAppPreview
      ? 'Shared App URL ready for phone camera QR pairing'
      : 'Public / LAN Server URL ready for QR pairing',
    explanation:
      'Phones and remote collectors can reach this origin directly without Google developer-preview 403 restrictions.',
  };
}

export function buildShortPairUrl(baseUrl: string, shortCode: string): string {
  const origin = normalizeBaseOrigin(baseUrl) ?? baseUrl.trim().replace(/\/$/, '');
  return `${origin}/?c=${encodeURIComponent(shortCode.trim().toUpperCase())}`;
}

export function buildManualPairUrl(baseUrl: string): string {
  const origin = normalizeBaseOrigin(baseUrl) ?? baseUrl.trim().replace(/\/$/, '');
  return `${origin}/?pair=1`;
}

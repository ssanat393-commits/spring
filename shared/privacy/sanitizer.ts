import type {
  EgressProofResult,
  PrivacyControls,
  RawLocalTelemetry,
  SanitizedCloudPayload,
  SanitizedProcessEntry,
  SensitiveCategory,
  SensitiveFieldDetection,
} from '../types';

export const DEFAULT_PRIVACY_CONTROLS: PrivacyControls = {
  cloudSyncEnabled: true,
  shareHostnames: false,
  shareProcessNames: true,
  shareProcessArgs: false,
  shareNetworkRates: true,
  redactUsernames: true,
  redactFilePaths: true,
  redactCredentials: true,
  redactInternalIps: true,
};

const CREDENTIAL_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z\-_]{20,}\b/g },
  { name: 'Bearer Token', regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { name: 'OpenAI / Secret Key', regex: /\bsk-[A-Za-z0-9\-_]{16,}\b/g },
  { name: 'GitHub Token', regex: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: 'CLI Secret Flag',
    regex: /(--?(?:password|passwd|pwd|token|secret|api[-_]?key|auth|jwt|dsn|connection[-_]?string)\s*(?:=|\s+)\s*)([^\s"']+|"[^"]*"|'[^']*')/gi,
  },
  {
    name: 'ENV Credential Assignment',
    regex: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*)=([^\s"']+|"[^"]*"|'[^']*')/g,
  },
  {
    name: 'Database URI Credentials',
    regex: /((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:)([^@\s]+)(@)/gi,
  },
];

const FILE_PATH_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'macOS User Path', regex: /\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"']*)*/g },
  { name: 'Linux Home Path', regex: /\/home\/[A-Za-z0-9._-]+(?:\/[^\s"']*)*/g },
  { name: 'Windows User Path', regex: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\[^\s"']*)*/g },
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

function deterministicShortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function maskSnippet(value: string): string {
  if (value.length <= 6) {
    return '***';
  }
  return `${value.slice(0, 3)}…${value.slice(-2)}`;
}

export function computePolicyHash(controls: PrivacyControls): string {
  return `pol-${deterministicShortHash(JSON.stringify(controls))}`;
}

export function computePayloadHash(payload: unknown): string {
  return `sha256-sim-${deterministicShortHash(JSON.stringify(payload))}`;
}

export function sanitizeStringValue(
  value: string,
  fieldPath: string,
  controls: PrivacyControls,
  knownUsernames: string[],
  detections: SensitiveFieldDetection[]
): string {
  let result = value;

  const pushDetection = (
    category: SensitiveCategory,
    original: string,
    replacement: string,
    ruleName: string,
    action: 'redacted' | 'blocked' | 'hashed' = 'redacted'
  ) => {
    detections.push({
      id: `det-${detections.length + 1}-${deterministicShortHash(`${fieldPath}:${ruleName}:${original}`)}`,
      fieldPath,
      category,
      originalSnippet: maskSnippet(original),
      replacement,
      action,
      ruleName,
    });
  };

  if (controls.redactCredentials) {
    for (const pattern of CREDENTIAL_PATTERNS) {
      result = result.replace(pattern.regex, (fullMatch, g1, g2, g3) => {
        if (pattern.name === 'Database URI Credentials' && g1 && g2 && g3) {
          pushDetection('credential', g2, '[REDACTED_SECRET]', pattern.name);
          return `${g1}[REDACTED_SECRET]${g3}`;
        }
        if ((pattern.name === 'CLI Secret Flag' || pattern.name === 'ENV Credential Assignment') && g1 && g2) {
          const prefix = pattern.name === 'ENV Credential Assignment' ? `${g1}=` : g1;
          pushDetection('credential', g2, '[REDACTED_SECRET]', pattern.name);
          return `${prefix}[REDACTED_SECRET]`;
        }
        pushDetection('credential', fullMatch, '[REDACTED_TOKEN]', pattern.name);
        return '[REDACTED_TOKEN]';
      });
    }
  }

  if (controls.redactFilePaths) {
    for (const pattern of FILE_PATH_PATTERNS) {
      result = result.replace(pattern.regex, (match) => {
        pushDetection('file_path', match, '[REDACTED_PERSONAL_PATH]', pattern.name);
        return '[REDACTED_PERSONAL_PATH]';
      });
    }
  }

  if (controls.redactUsernames) {
    for (const username of knownUsernames) {
      if (!username || username.trim().length < 2) continue;
      const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const userRegex = new RegExp(`\\b${escaped}\\b`, 'g');
      result = result.replace(userRegex, (match) => {
        pushDetection('username', match, '[REDACTED_USER]', 'Operator Username Filter');
        return '[REDACTED_USER]';
      });
    }

    result = result.replace(EMAIL_PATTERN, (match) => {
      pushDetection('email', match, '[REDACTED_EMAIL]', 'Email Address Filter');
      return '[REDACTED_EMAIL]';
    });
  }

  if (controls.redactInternalIps) {
    result = result.replace(IPV4_PATTERN, (match) => {
      pushDetection('ip_address', match, '[REDACTED_IP]', 'IPv4 Address Filter');
      return '[REDACTED_IP]';
    });
  }

  return result;
}

function summarizeOsFamily(osString: string): string {
  const lower = osString.toLowerCase();
  if (lower.includes('ubuntu') || lower.includes('debian') || lower.includes('linux')) {
    return 'Linux (x86_64/arm64)';
  }
  if (lower.includes('darwin') || lower.includes('macos')) {
    return 'macOS';
  }
  if (lower.includes('win')) {
    return 'Windows';
  }
  return 'POSIX System';
}

export function sanitizeTelemetryForEgress(
  raw: RawLocalTelemetry,
  controls: PrivacyControls = DEFAULT_PRIVACY_CONTROLS
): EgressProofResult {
  const detections: SensitiveFieldDetection[] = [];
  const knownUsernames = Array.from(
    new Set(
      [
        raw.operatorUser,
        ...raw.processes.map((p) => p.user ?? ''),
      ].filter((u) => Boolean(u && u !== 'root' && u !== 'SYSTEM' && u !== 'www-data'))
    )
  );

  if (raw.operatorUser) {
    detections.push({
      id: `det-blk-user-${deterministicShortHash(raw.operatorUser)}`,
      fieldPath: 'rawLocal.operatorUser',
      category: 'username',
      originalSnippet: maskSnippet(raw.operatorUser),
      replacement: '[OMITTED_FROM_EGRESS]',
      action: 'blocked',
      ruleName: 'Local Operator Identity Isolation',
    });
  }

  if (raw.homeDir) {
    detections.push({
      id: `det-blk-home-${deterministicShortHash(raw.homeDir)}`,
      fieldPath: 'rawLocal.homeDir',
      category: 'file_path',
      originalSnippet: maskSnippet(raw.homeDir),
      replacement: '[OMITTED_FROM_EGRESS]',
      action: 'blocked',
      ruleName: 'Personal Home Directory Isolation',
    });
  }

  if (raw.localIp && controls.redactInternalIps) {
    detections.push({
      id: `det-blk-ip-${deterministicShortHash(raw.localIp)}`,
      fieldPath: 'rawLocal.localIp',
      category: 'ip_address',
      originalSnippet: maskSnippet(raw.localIp),
      replacement: '[OMITTED_FROM_EGRESS]',
      action: 'blocked',
      ruleName: 'Internal IP Stripping',
    });
  }

  if (raw.envHints && Object.keys(raw.envHints).length > 0) {
    for (const [envKey, envVal] of Object.entries(raw.envHints)) {
      detections.push({
        id: `det-blk-env-${deterministicShortHash(envKey)}`,
        fieldPath: `rawLocal.envHints.${envKey}`,
        category: 'credential',
        originalSnippet: maskSnippet(envVal),
        replacement: '[BLOCKED_LOCAL_ONLY]',
        action: 'blocked',
        ruleName: 'Local Environment Secret Firewall',
      });
    }
  }

  const hostToken = `host-${deterministicShortHash(raw.hostId + raw.hostname)}`;
  let displayLabel = raw.hostAlias;

  if (!controls.shareHostnames) {
    detections.push({
      id: `det-hash-host-${deterministicShortHash(raw.hostname)}`,
      fieldPath: 'rawLocal.hostname',
      category: 'hostname',
      originalSnippet: maskSnippet(raw.hostname),
      replacement: hostToken,
      action: 'hashed',
      ruleName: 'Hostname Pseudonymization',
    });
    displayLabel = `${raw.hostAlias} (${hostToken})`;
  } else {
    displayLabel = raw.hostname;
  }

  const sanitizedProcesses: SanitizedProcessEntry[] = raw.processes.map((proc, index) => {
    const procName = controls.shareProcessNames
      ? sanitizeStringValue(proc.name, `processes[${index}].name`, controls, knownUsernames, detections)
      : `proc-${deterministicShortHash(proc.name).slice(0, 6)}`;

    if (!controls.shareProcessNames) {
      detections.push({
        id: `det-hash-proc-${index}`,
        fieldPath: `processes[${index}].name`,
        category: 'process_arg',
        originalSnippet: maskSnippet(proc.name),
        replacement: procName,
        action: 'hashed',
        ruleName: 'Process Name Obfuscation Policy',
      });
    }

    if (proc.user && controls.redactUsernames) {
      detections.push({
        id: `det-blk-puser-${index}`,
        fieldPath: `processes[${index}].user`,
        category: 'username',
        originalSnippet: maskSnippet(proc.user),
        replacement: '[OMITTED_FROM_EGRESS]',
        action: 'blocked',
        ruleName: 'Process Owner Identity Strip',
      });
    }

    let sanitizedCmd = '[ARGS_STRIPPED_BY_POLICY]';
    if (!controls.shareProcessArgs) {
      if (proc.cmdline && proc.cmdline.trim().length > 0) {
        // Still run pattern detectors so the user sees what credentials/paths would have leaked!
        sanitizeStringValue(proc.cmdline, `processes[${index}].cmdline`, controls, knownUsernames, detections);
        detections.push({
          id: `det-blk-pcmd-${index}`,
          fieldPath: `processes[${index}].cmdline`,
          category: 'process_arg',
          originalSnippet: maskSnippet(proc.cmdline),
          replacement: '[ARGS_STRIPPED_BY_POLICY]',
          action: 'blocked',
          ruleName: 'Zero Process Argument Egress Policy',
        });
      }
      sanitizedCmd = `${procName} [ARGS_STRIPPED_BY_POLICY]`;
    } else {
      sanitizedCmd = sanitizeStringValue(
        proc.cmdline,
        `processes[${index}].cmdline`,
        controls,
        knownUsernames,
        detections
      );
    }

    return {
      pid: proc.pid,
      name: procName,
      cpuPct: Number(proc.cpuPct.toFixed(1)),
      memPct: Number(proc.memPct.toFixed(1)),
      sanitizedCmd,
    };
  });

  if (!controls.shareNetworkRates) {
    detections.push({
      id: `det-blk-net-${deterministicShortHash(raw.hostId)}`,
      fieldPath: 'rawLocal.netRxKbps / netTxKbps',
      category: 'ip_address',
      originalSnippet: `${raw.netRxKbps}/${raw.netTxKbps} kbps`,
      replacement: 'null (withheld)',
      action: 'blocked',
      ruleName: 'Network Telemetry Withholding',
    });
  }

  const approvedPayload: SanitizedCloudPayload = {
    hostToken,
    displayLabel,
    osFamily: summarizeOsFamily(raw.os),
    uptimeSeconds: Math.round(raw.uptimeSeconds),
    cpuPct: Number(raw.cpuPct.toFixed(1)),
    ramPct: Number(raw.ramPct.toFixed(1)),
    diskPct: Number(raw.diskPct.toFixed(1)),
    netRxKbps: controls.shareNetworkRates ? Number(raw.netRxKbps.toFixed(1)) : null,
    netTxKbps: controls.shareNetworkRates ? Number(raw.netTxKbps.toFixed(1)) : null,
    loadAvg: [
      Number(raw.loadAvg[0].toFixed(2)),
      Number(raw.loadAvg[1].toFixed(2)),
      Number(raw.loadAvg[2].toFixed(2)),
    ],
    processes: sanitizedProcesses,
    collectedAt: raw.collectedAt,
    privacyPolicyHash: computePolicyHash(controls),
    isDemo: raw.isDemo,
  };

  const fieldsSanitizedCount = detections.filter((d) => d.action === 'redacted' || d.action === 'hashed').length;
  const blockedFieldsCount = detections.filter((d) => d.action === 'blocked').length;

  return {
    rawLocal: raw,
    sensitiveFieldsDetected: detections,
    fieldsSanitizedCount,
    blockedFieldsCount,
    approvedPayload,
    policyControls: controls,
    rawByteSize: new TextEncoder().encode(JSON.stringify(raw)).length,
    sanitizedByteSize: new TextEncoder().encode(JSON.stringify(approvedPayload)).length,
    generatedAt: new Date().toISOString(),
  };
}

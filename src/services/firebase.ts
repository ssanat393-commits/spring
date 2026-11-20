export interface FirebaseRuntimeStatus {
  configured: boolean;
  projectId: string | null;
  authDomain: string | null;
  mode: 'firebase-ready' | 'local-sqlite-mode';
}

export function getFirebaseRuntimeStatus(): FirebaseRuntimeStatus {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;

  const configured = Boolean(apiKey && projectId && apiKey.trim().length > 5);
  return {
    configured,
    projectId: configured ? projectId ?? null : null,
    authDomain: configured ? authDomain ?? null : null,
    mode: configured ? 'firebase-ready' : 'local-sqlite-mode',
  };
}

import { useRef, useState } from "react";
import API from "../services/api";

const GOOGLE_SCRIPT_ID = "google-identity-services";
const GOOGLE_SCOPE = "openid email profile";

const loadGoogleIdentityScript = () =>
  new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }

    const existing = document.getElementById(GOOGLE_SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google authentication could not be loaded.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google authentication could not be loaded."));
    document.head.appendChild(script);
  });

const GoogleIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" focusable="false">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

export default function GoogleAuthButton({ label = "Continue with Google", onSuccess, onError }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  const fail = (message) => {
    busyRef.current = false;
    setLoading(false);
    onError?.(message);
  };

  const startGoogleAuth = async () => {
    if (busyRef.current) return;
    if (!clientId) {
      fail("Google authentication is not configured yet.");
      return;
    }

    busyRef.current = true;
    setLoading(true);
    onError?.("");

    try {
      await loadGoogleIdentityScript();
      const client = window.google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: GOOGLE_SCOPE,
        ux_mode: "popup",
        select_account: true,
        callback: async (response) => {
          if (response?.error || !response?.code) {
            fail("Google authentication was cancelled. Please try again.");
            return;
          }

          try {
            const result = await API.post(
              "/api/auth/google",
              { code: response.code, redirectUri: window.location.origin },
              { headers: { "X-Requested-With": "XmlHttpRequest" } }
            );
            busyRef.current = false;
            setLoading(false);
            onSuccess?.(result.data);
          } catch (err) {
            fail(err.response?.data?.error || "Google authentication failed. Please try again.");
          }
        },
        error_callback: (error) => {
          const type = error?.type;
          fail(type === "popup_closed"
            ? "Google authentication was cancelled. Please try again."
            : "Google authentication could not start. Check your browser popup settings.");
        },
      });
      client.requestCode();
    } catch {
      fail("Google authentication could not start. Please try again.");
    }
  };

  return (
    <button type="button" className="btn-social btn-google" onClick={startGoogleAuth} disabled={loading}>
      {loading ? <span className="spinner spinner-small" aria-hidden="true" /> : <GoogleIcon />}
      <span>{loading ? "Connecting to Google..." : label}</span>
    </button>
  );
}

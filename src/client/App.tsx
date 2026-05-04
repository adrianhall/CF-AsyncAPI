/**
 * Root React component for AsyncAPI.
 *
 * Fetches basic metadata from `/api/version` (public) and user info
 * from `/api/me` (authenticated) on mount and renders a landing page
 * showing the results.
 *
 * @module
 */

import { useEffect, useState } from "react";

/** Shape returned by `GET /api/version`. */
interface ApiInfo {
  name: string;
  version: string;
}

/** Shape returned by `GET /api/me`. */
interface UserInfo {
  email: string;
  id: string;
}

/** Root application component. */
function App() {
  const [info, setInfo] = useState<ApiInfo | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/version")
      .then((res) => {
        if (!res.ok) throw new Error(`API responded with ${res.status}`);
        return res.json() as Promise<ApiInfo>;
      })
      .then(setInfo)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error");
      });

    fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error(`User API responded with ${res.status}`);
        return res.json() as Promise<UserInfo>;
      })
      .then(setUser)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error");
      });
  }, []);

  return (
    <div className="app">
      {user && (
        <div className="user-badge">
          <span className="user-email">{user.email}</span>
          <span className="user-id">{user.id}</span>
        </div>
      )}

      <h1>AsyncAPI</h1>
      <p>A simple Async API demo built on Cloudflare Workers</p>

      {error && <p className="error">API error: {error}</p>}

      {info && (
        <p className="api-info">
          Connected to {info.name} v{info.version}
        </p>
      )}
    </div>
  );
}

export default App;

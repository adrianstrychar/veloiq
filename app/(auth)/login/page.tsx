'use client';

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

type Mode = 'password' | 'magic-link';

export default function LoginPage() {
  const supabase = createBrowserSupabaseClient();

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }

    // Po zalogowaniu — połącz konto ze Strava (sekcja 14)
    window.location.href = '/api/strava/auth';
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signUp({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }

    setMessage('Konto utworzone. Sprawdź e-mail, aby potwierdzić rejestrację, a następnie zaloguj się.');
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/strava/auth`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }

    setMessage('Link logowania wysłany na e-mail. Kliknij w niego, aby się zalogować.');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">VeloIQ</h1>
          <p className="text-secondary text-sm mt-1">Twój AI trener. Zawsze gotowy.</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => setMode('password')}
              className={`flex-1 text-sm font-semibold py-2 rounded-xl ${
                mode === 'password' ? 'bg-accent text-background' : 'border border-border text-secondary'
              }`}
            >
              Email i hasło
            </button>
            <button
              type="button"
              onClick={() => setMode('magic-link')}
              className={`flex-1 text-sm font-semibold py-2 rounded-xl ${
                mode === 'magic-link' ? 'bg-accent text-background' : 'border border-border text-secondary'
              }`}
            >
              Magic link
            </button>
          </div>

          <form onSubmit={mode === 'password' ? handleSignIn : handleMagicLink} className="flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background border border-border rounded-xl px-3 py-2 text-sm"
            />

            {mode === 'password' && (
              <input
                type="password"
                required
                placeholder="Hasło"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-2 text-sm"
              />
            )}

            {error && <p className="text-sm text-accent-danger">{error}</p>}
            {message && <p className="text-sm text-accent-info">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="bg-accent text-background text-sm font-semibold rounded-xl py-2 disabled:opacity-50"
            >
              {mode === 'password' ? 'Zaloguj się' : 'Wyślij magic link'}
            </button>

            {mode === 'password' && (
              <button
                type="button"
                onClick={handleSignUp}
                disabled={loading}
                className="border border-border text-sm font-semibold rounded-xl py-2 disabled:opacity-50"
              >
                Zarejestruj się
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

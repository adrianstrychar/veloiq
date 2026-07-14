// Strava API wrapper + OAuth (sekcja 14)

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
  };
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token exchange failed: ${response.status}`);
  }

  return response.json();
}

export async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.status}`);
  }

  return response.json();
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  start_date: string;
  start_date_local?: string; // data lokalna zawodnika (preferowana do activity_date)
  distance: number; // meters
  moving_time: number; // seconds
  total_elevation_gain: number; // meters
  average_watts?: number;
  max_watts?: number;
  weighted_average_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
}

// Profil atlety z GET /athlete — prefill onboardingu. Strava zwraca `weight` (kg) i `sex` ('M'/'F')
// jeśli user je ustawił; `ftp` bywa obecne dla kont z miernikiem. Wszystko może być null/brak.
// Scope profile:read_all wystarcza (mamy go). Nie rzuca — braki to null (onboarding dopyta).
export interface StravaAthleteProfile {
  weight: number | null;     // kg
  ftp: number | null;        // W
  sex: 'M' | 'F' | null;
}

export async function fetchStravaAthleteProfile(accessToken: string): Promise<StravaAthleteProfile> {
  const response = await fetch('https://www.strava.com/api/v3/athlete', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Strava athlete profile fetch failed: ${response.status}`);
  }
  const a = await response.json();
  const sex = a.sex === 'M' || a.sex === 'F' ? a.sex : null;
  return {
    weight: typeof a.weight === 'number' && a.weight > 0 ? a.weight : null,
    ftp: typeof a.ftp === 'number' && a.ftp > 0 ? Math.round(a.ftp) : null,
    sex,
  };
}

// Totale z GET /athletes/{id}/stats (dystanse w metrach).
export interface StravaTotals {
  count: number;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  elevation_gain: number;
}

export interface StravaAthleteStats {
  ytd_ride_totals?: StravaTotals;
  all_ride_totals?: StravaTotals;
  recent_ride_totals?: StravaTotals;
}

// Statystyki atlety (YTD/all-time). Wymaga tylko scope `read` dla własnego konta —
// nasz scope (read,activity:read_all,profile:read_all) wystarcza.
export async function fetchStravaAthleteStats(
  accessToken: string,
  stravaId: number
): Promise<StravaAthleteStats> {
  const response = await fetch(
    `https://www.strava.com/api/v3/athletes/${stravaId}/stats`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Strava stats fetch failed: ${response.status}`);
  }

  return response.json();
}

// Szczegóły JEDNEJ aktywności — potrzebne `description` (endpoint listy go nie zwraca), żeby
// DOPISAĆ naszą linię zamiast nadpisać. Read (activity:read_all wystarcza).
export async function fetchStravaActivityDetail(
  accessToken: string,
  activityId: number | string
): Promise<{ id: number; name: string; description: string | null }> {
  const response = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error(`Strava activity detail failed: ${response.status}`);
  }
  const a = await response.json();
  return { id: a.id, name: a.name, description: a.description ?? null };
}

// WRITE: aktualizuje opis aktywności. Wymaga scope activity:write — bez niego Strava zwraca 403.
// PUT /activities/{id} z polem description (application/json). Zwraca status HTTP do rozróżnienia
// 403 (brak scope → CTA re-connect) od innych błędów.
export async function updateStravaActivity(
  accessToken: string,
  activityId: number | string,
  patch: { description: string }
): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: patch.description }),
    }
  );
  return { ok: response.ok, status: response.status };
}

// Pobiera aktywności z konta Stravy (sekcja 15)
export async function fetchStravaActivities(
  accessToken: string,
  after: number
): Promise<StravaActivity[]> {
  const params = new URLSearchParams({
    after: String(after),
    per_page: '100',
  });

  const response = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Strava activities fetch failed: ${response.status}`);
  }

  return response.json();
}

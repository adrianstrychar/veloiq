import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyDevice } from '@/lib/garmin/auth';
import { askEnzoForScreen } from '@/lib/garmin/ask';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// Pytanie do Enzo z licznika Garmin (przycisk ENZO): odpowiedź tekstowa na ekran + ewentualne polecenie dla jazdy.
export async function POST(req: NextRequest) {
  const admin = createAdminSupabaseClient();
  const dev = await verifyDevice(admin, req.headers.get('authorization'));
  if (!dev) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { question?: unknown; state?: unknown };
  const question = String(body.question ?? '').trim().slice(0, 300);
  if (!question) return NextResponse.json({ error: 'empty' }, { status: 400 });
  const state = (body.state && typeof body.state === 'object' ? body.state : {}) as Record<string, unknown>;

  try {
    return NextResponse.json(await askEnzoForScreen(admin, dev.userId, question, state));
  } catch (e) {
    console.error('[garmin/ask]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'ai_unavailable' }, { status: 502 });
  }
}

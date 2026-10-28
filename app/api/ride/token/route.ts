import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { signRideToken } from '@/lib/ride/ride-token';

export const dynamic = 'force-dynamic';

// Start jazdy w aplikacji: token, którym natywny plugin pyta trenera (/api/ride/ask).
export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  return NextResponse.json({ token: signRideToken(user.id) });
}

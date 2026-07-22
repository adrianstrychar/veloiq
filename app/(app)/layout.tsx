import { redirect } from 'next/navigation';
import { BottomNav } from '@/components/veloiq/BottomNav';
import { ChatProvider } from '@/components/veloiq/ChatStore';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isProfileComplete } from '@/lib/onboarding';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // GATE onboardingu: user PO podłączeniu Stravy (wiersz athlete istnieje), ale z niedokończonym
  // onboardingiem → /onboarding. Brak wiersza (nie podłączył Stravy) NIE jest bramkowany — dashboard
  // pokazuje CTA "Połącz Stravę" jak dotąd (nie wysyłamy na onboarding bez tokenu Stravy).
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: athlete } = await supabase
      .from('athletes')
      .select('onboarding_completed')
      .eq('user_id', user.id)
      .maybeSingle();
    if (athlete && !isProfileComplete(athlete)) redirect('/onboarding');
  }

  // ChatProvider owija zakładki → stan czatu przeżywa nawigację (layout nie remontuje się).
  return (
    <ChatProvider>
      <div className="min-h-screen pb-20">
        {/* Shell NIE narzuca szerokości — każda strona deklaruje własny kontener:
            mobilne widoki (plan/chat/kalendarz/wyścigi) = max-w-md mx-auto,
            dashboard = własny kontener ~1100px (dashboard.module.css .page).
            Wcześniej twardy max-w-md=448px więził dashboard: grid @media(min-width:860px)
            mierzy viewport (np. 2500px → 2 kolumny) przy realnej szerokości 448px → ściśnięte karty. */}
        <main className="px-4 py-4">{children}</main>
        <BottomNav />
      </div>
    </ChatProvider>
  );
}

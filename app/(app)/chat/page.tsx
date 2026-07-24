'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatStore, type Message, type PendingCard } from '@/components/veloiq/ChatStore';
import { C, F } from '@/lib/theme';
import { Activity, TrendingUp, SlidersHorizontal, Flag, LineChart, ChevronRight } from 'lucide-react';
import { LogoVeloIQ } from '@/components/veloiq/LogoVeloIQ';

// Reskin (ETAP CHAT część 2): tekst trenera BEZ dymka, <b> zielony (C.green), tabele scrollowalne.
// GFM (tabele, ~strike~, task-listy). Tabela w overflow-x-auto — na wąskim iPhone scrolluje, nie rozpycha.
const mdComponents: Components = {
  strong: ({ node, ...props }) => <strong style={{ color: C.green, fontWeight: 700 }} {...props} />,
  p: ({ node, ...props }) => <p style={{ margin: '0 0 0.55rem' }} {...props} />,
  a: ({ node, ...props }) => <a style={{ color: C.cyan, textDecoration: 'underline' }} {...props} />,
  table: ({ node, ...props }) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }} {...props} />
    </div>
  ),
  th: ({ node, ...props }) => <th style={{ border: `1px solid ${C.border}`, padding: '4px 8px', textAlign: 'left', fontWeight: 600 }} {...props} />,
  td: ({ node, ...props }) => <td style={{ border: `1px solid ${C.border}`, padding: '4px 8px', verticalAlign: 'top' }} {...props} />,
};

const TEXTAREA_MAX = 120; // ~4 linie przy 16px; powyżej scroll wewnętrzny (część 2.8)
const CYAN_FOCUS = 'rgba(74,143,199,0.55)'; // C.cyan @55% — obrys pola w focusie (część 2.7)
const GOLD = '#C99A4E'; // C.yellow — karta propozycji (część 2.5)

// Etykieta "TRENER" (opc. "· BRIEF DNIA") nad wiadomością trenera / briefem / typingiem (część 2.2/2.6/3.1).
function CoachLabel({ suffix }: { suffix?: string }) {
  return (
    <div style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.cyan, marginBottom: 6, fontWeight: 600 }}>
      {suffix ? `Trener · ${suffix}` : 'Trener'}
    </div>
  );
}

// Brief dnia + startery (część 3). Endpoint /api/ai/brief zwraca tekst briefu (cache Haiku) + dane
// do podtytułów starterów; ikony/kolory (lucide + C.*) buduje klient. Tap startera = preset (jak chip).
interface BriefStarter { key: string; icon: React.ReactNode; tint: string; title: string; subtitle: string; prompt: string }
interface BriefData {
  brief: string | null;
  today: { type: string; label: string; isRest: boolean };
  last: { name: string; km: number; tss: number } | null;
  race: { name: string; days: number } | null;
}

function buildStarters(d: BriefData): BriefStarter[] {
  const { today, last, race } = d;
  return [
    { key: 'today', icon: <Activity size={17} color={C.cyan} strokeWidth={2} />, tint: C.cyan, title: 'Omów dzisiejszy trening',
      subtitle: today && !today.isRest && today.label ? today.label : 'Dzień wolny — co warto wiedzieć',
      prompt: 'Omów mój dzisiejszy trening z planu.' },
    { key: 'last', icon: <TrendingUp size={17} color={C.green} strokeWidth={2} />, tint: C.green, title: 'Jak wypadła ostatnia jazda?',
      subtitle: last ? `${last.name} · ${last.km} km · ${last.tss} TSS` : 'Brak jazdy do analizy',
      prompt: 'Jak wypadła moja ostatnia jazda?' },
    { key: 'plan', icon: <SlidersHorizontal size={17} color={C.yellow} strokeWidth={2} />, tint: C.yellow, title: 'Zmień coś w planie',
      subtitle: 'Przełóż, skróć albo dołóż trening — przeliczy tydzień',
      prompt: 'Chcę zmienić coś w planie na ten tydzień.' },
    race
      ? { key: 'race', icon: <Flag size={17} color={C.purple} strokeWidth={2} />, tint: C.purple, title: `Strategia na ${race.name}`,
          subtitle: `Pacing, żywienie i taper na start za ${race.days} dni`, prompt: `Jak przygotować się do startu "${race.name}"?` }
      : { key: 'ftp', icon: <LineChart size={17} color={C.purple} strokeWidth={2} />, tint: C.purple, title: 'Prognoza formy',
          subtitle: 'Dokąd zmierza Twoje FTP', prompt: 'Jak rozwija się moja forma i FTP?' },
  ];
}

// Karta startera (3.3): ikona lucide w kolorowym kwadracie 32px + tytuł + podtytuł z danych + chevron.
function StarterCard({ s, onClick }: { s: BriefStarter; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px', cursor: 'pointer' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: s.tint + '22' }}>{s.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text }}>{s.title}</span>
        <span style={{ display: 'block', fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subtitle}</span>
      </span>
      <ChevronRight size={16} color={C.faint} style={{ flexShrink: 0 }} />
    </button>
  );
}

export default function ChatPage() {
  // Stan wątku (messages/input/suggestions) ze store nad zakładkami — przeżywa nawigację.
  const { messages, setMessages, input, setInput, suggestions, setSuggestions, touch, ensureFresh } = useChatStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [briefText, setBriefText] = useState<string | null>(null);
  const [starters, setStarters] = useState<BriefStarter[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true); // czy user był przy dole listy (próg 120px) — steruje auto-scrollem

  // Wejście na czat: jeśli minęło > 30 min bezczynności, wyczyść wątek (świeży start).
  useEffect(() => {
    ensureFresh();
  }, [ensureFresh]);

  // Kotwiczenie WŁASNE (wymóg 1.6): scroll do dołu TYLKO gdy user był przy dole (próg 120px) — nie
  // szarpiemy, gdy czyta historię w górze. onListScroll aktualizuje flagę na każdym przewinięciu.
  const NEAR_BOTTOM_PX = 120;
  function scrollListToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }
  function onListScroll() {
    const el = listRef.current;
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }
  useEffect(() => {
    if (nearBottomRef.current) scrollListToBottom();
  }, [messages, loading]);

  // Klawiatura (wymóg 1.3, iOS fallback): visualViewport — gdy dostępny, wysokość kontenera =
  // viewport widoczny − BottomNav (NAV_PX = pb-20 shella, 5rem). Listener z cleanupem. Bez vv
  // wysokość trzyma CSS calc(100dvh − 7rem). Klawiatura zmniejsza vv.height → input jedzie w górę.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const NAV_PX = 80;
    const apply = () => {
      const el = containerRef.current;
      if (el) el.style.height = `${vv.height - NAV_PX}px`;
    };
    apply();
    vv.addEventListener('resize', apply);
    return () => vv.removeEventListener('resize', apply);
  }, []);

  // Focus na polu (wymóg 1.5): po rAF przewiń listę do dołu, żeby klawiatura nie zasłoniła ostatniej.
  function onInputFocus() {
    requestAnimationFrame(scrollListToBottom);
  }

  // Sugerowane pytania (chips) — deterministyczne. Pobierz raz; przy powrocie na czat ze
  // stanem w store już są, nie odpytujemy ponownie.
  useEffect(() => {
    if (suggestions.length > 0) return;
    fetch('/api/ai/suggestions')
      .then((r) => r.json())
      .then((d) => setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []))
      .catch(() => setSuggestions([]));
  }, [suggestions.length, setSuggestions]);

  // Brief dnia + startery (część 3.1-3.3): tylko na pustym czacie (brak dzisiejszej rozmowy). Tekst
  // briefu cache'owany server-side per dzień → brak kosztu przy kolejnych wejściach. Błąd AI → same
  // startery (data-driven, bez AI). Startery znikają po pierwszej wiadomości usera (patrz hasUserMessage).
  useEffect(() => {
    if (messages.length > 0) return;
    fetch('/api/ai/brief')
      .then((r) => r.json())
      .then((d: BriefData) => { setBriefText(d.brief ?? null); setStarters(buildStarters(d)); })
      .catch(() => { setBriefText(null); setStarters([]); });
  }, [messages.length]);

  // Auto-grow textarea do TEXTAREA_MAX, potem scroll wewnętrzny (część 2.8).
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX)}px`;
  }

  async function sendMessage(textArg?: string) {
    const text = (typeof textArg === 'string' ? textArg : input).trim();
    if (!text || loading) return;
    touch(); // aktywność → reset 30-min okna świeżości

    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    nearBottomRef.current = true; // user właśnie wysłał → zawsze zjedź do jego wiadomości
    setMessages(nextMessages);
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto'; // reset wysokości po wysłaniu
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Wysyłamy TYLKO {role, content} — pendings to stan UI (Anthropic API nie zna tego pola).
        body: JSON.stringify({ messages: nextMessages.map((m) => ({ role: m.role, content: m.content })) }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Błąd serwera');
        return;
      }

      const pendings: PendingCard[] = Array.isArray(data.pendings)
        ? data.pendings.map((p: Omit<PendingCard, 'status'>) => ({ ...p, status: 'pending' as const }))
        : [];
      setMessages([...nextMessages, { role: 'assistant', content: data.reply, pendings }]);
    } catch {
      setError('Nie udało się połączyć z serwerem');
    } finally {
      setLoading(false);
    }
  }

  // Aktualizuje pojedynczą kartę (po change_id) — karty są niezależne, jedna nie rusza drugiej.
  function updatePending(changeId: string, patch: Partial<PendingCard>) {
    setMessages((prev) =>
      prev.map((m) =>
        m.pendings ? { ...m, pendings: m.pendings.map((p) => (p.change_id === changeId ? { ...p, ...patch } : p)) } : m
      )
    );
  }

  // Klik [Zatwierdź]/[Później] → BEZPOŚREDNI POST na endpoint, z pominięciem modelu (deterministyczne).
  async function handlePending(pending: PendingCard, action: 'commit' | 'cancel') {
    if (pending.busy || pending.status !== 'pending') return;
    touch(); // aktywność → reset 30-min okna świeżości
    updatePending(pending.change_id, { busy: true });
    try {
      const res = await fetch(`/api/ai/pending/${pending.change_id}/${action}`, { method: 'POST' });
      const data = await res.json();

      if (action === 'cancel') {
        updatePending(pending.change_id, { status: 'cancelled', busy: false });
        return;
      }
      if (data.ok) {
        updatePending(pending.change_id, { status: 'committed', resultMsg: data.message, busy: false });
        // Świadomość modelu: dopisz potwierdzenie do wątku (trafia do historii kolejnej tury).
        setMessages((prev) => [...prev, { role: 'assistant', content: `✓ ${data.message ?? 'Zapisano.'}` }]);
      } else {
        // wygasło / już zastosowano / dane się zmieniły → czytelny komunikat, nie surowy błąd.
        updatePending(pending.change_id, { status: 'expired', resultMsg: data.error ?? 'Propozycja nieaktualna — poproś ponownie.', busy: false });
      }
    } catch {
      updatePending(pending.change_id, { busy: false, resultMsg: 'Błąd połączenia — spróbuj ponownie.' });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const statusText = loading ? 'pisze…' : 'zawsze online';
  const canSend = !loading && input.trim().length > 0;
  const hasUserMessage = messages.some((m) => m.role === 'user'); // pierwsza wiadomość usera → chowa brief+startery

  return (
    // Wymóg 1.1: wysokość 100dvh (NIE 100vh) − chrome shella (BottomNav 5rem + py-4 2rem = 7rem).
    // Flex: header (shrink-0) + lista (flex-1, scroll) + input (shrink-0). visualViewport nadpisuje
    // height pikselami przy klawiaturze (efekt wyżej). Nie ruszamy app-shella.
    <div ref={containerRef} className="flex flex-col max-w-md mx-auto" style={{ height: 'calc(100dvh - 7rem)' }}>
      {/* Self-contained CSS: bounce typingu + ukrycie scrollbara chipów (bez dotykania globals.css) */}
      <style>{`@keyframes veloChatBounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}.velo-noscroll::-webkit-scrollbar{display:none}`}</style>

      {/* HEADER wycentrowany: logo VeloIQ (spójnie z innymi zakładkami) + "Trener" + mikro-status */}
      <header style={{ padding: '12px 0 11px', borderBottom: `1px solid ${C.border}`, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 7 }}>
          <LogoVeloIQ height={22} />
        </div>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 16, color: C.text, lineHeight: 1.1 }}>Trener</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 10.5, color: C.muted }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
          {statusText}
        </div>
      </header>

      {/* LISTA (flex-1, scroll). Wymóg 1.6: overflow-anchor none + własne kotwiczenie; 1.7: overscroll contain. */}
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="flex-1 overflow-y-auto"
        style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        {/* BRIEF DNIA + STARTERY (część 3.1-3.3): przed pierwszą wiadomością usera. Brief jako wiadomość
            trenera (etykieta "TRENER · BRIEF DNIA"); pod nim 4 startery. Fallback: sam hint, gdy brak briefu. */}
        {!hasUserMessage && (
          <>
            {briefText && (
              <div>
                <CoachLabel suffix="Brief dnia" />
                <div style={{ fontSize: '0.78rem', lineHeight: 1.65, color: C.text, fontFamily: F.body }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{briefText}</ReactMarkdown>
                </div>
              </div>
            )}
            {starters.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {starters.map((s) => (
                  <StarterCard key={s.key} s={s} onClick={() => sendMessage(s.prompt)} />
                ))}
              </div>
            )}
            {!briefText && starters.length === 0 && !loading && (
              <p style={{ color: C.muted, fontSize: 12.5, textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
                Napisz do trenera — plan, forma, analiza jazdy, żywienie albo przygotowanie do startu.
              </p>
            )}
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: m.role === 'user' ? 'flex-end' : 'stretch' }}>
            {m.role === 'user' ? (
              // WIADOMOŚĆ UŻYTKOWNIKA (2.3): cichy dymek panelHi, radius 18 z dziubkiem 6 w prawym górnym, max 80%, do prawej
              <div style={{ alignSelf: 'flex-end', maxWidth: '80%', background: C.panelHi, color: C.text, borderRadius: '18px 6px 18px 18px', padding: '9px 13px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {m.content}
              </div>
            ) : (
              // WIADOMOŚĆ TRENERA (2.2): bez dymka, etykieta TRENER, sam tekst (fs .78rem, lh 1.65)
              <div>
                <CoachLabel />
                <div style={{ fontSize: '0.78rem', lineHeight: 1.65, color: C.text, fontFamily: F.body }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{m.content}</ReactMarkdown>
                </div>
              </div>
            )}

            {m.pendings?.map((p) => (
              <ProposalCard key={p.change_id} p={p} onCommit={() => handlePending(p, 'commit')} onCancel={() => handlePending(p, 'cancel')} />
            ))}
          </div>
        ))}

        {/* TYPING INDICATOR (2.6): etykieta TRENER + trzy kropki bounce, bez dymka */}
        {loading && (
          <div>
            <CoachLabel />
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 12 }}>
              {[0, 1, 2].map((d) => (
                <span key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: C.muted, animation: 'veloChatBounce 1.2s infinite', animationDelay: `${d * 0.16}s` }} />
              ))}
            </div>
          </div>
        )}

        {error && <p style={{ textAlign: 'center', fontSize: 13, color: C.red }}>{error}</p>}
      </div>

      {/* DOLNA STREFA: chipy (empty-state) + input. Tło C.bg, top border, safe-area iPhone (wymóg 1.4). */}
      <div style={{ flexShrink: 0, background: C.bg, borderTop: `1px solid ${C.border}`, paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}>
        {/* CHIPY SUGESTII: TYLKO w trwającej rozmowie (po 1. wiadomości usera) — na ekranie startowym
            byłyby dublem starterów. W rozmowie są kontekstowe (pytania otwarte, patrz chat-suggestions). */}
        {hasUserMessage && suggestions.length > 0 && (
          <div className="velo-noscroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 16px 0', scrollbarWidth: 'none' }}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s.prompt)}
                style={{ flexShrink: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '8px 14px', fontSize: 12.5, color: C.text, whiteSpace: 'nowrap', cursor: 'pointer' }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* INPUT (2.7): pill radius 22, tło C.bg, border 1.5px (cyan w focusie) + przycisk okrągły 40px */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '12px 16px 0' }}>
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Napisz wiadomość…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { setInputFocused(true); onInputFocus(); }}
            onBlur={() => setInputFocused(false)}
            disabled={loading}
            // fontSize DOKŁADNIE 16px — poniżej iOS Safari zoomuje viewport przy focusie.
            style={{ flex: 1, background: C.bg, color: C.text, border: `1.5px solid ${inputFocused ? CYAN_FOCUS : C.border}`, borderRadius: 22, padding: '11px 16px', resize: 'none', overflowY: 'auto', lineHeight: 1.4, fontSize: 16, minHeight: 44, maxHeight: TEXTAREA_MAX, outline: 'none', fontFamily: F.body }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!canSend}
            aria-label="Wyślij"
            style={{ flexShrink: 0, width: 40, height: 40, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: canSend ? C.cyan : C.panelHi, color: canSend ? C.bg : C.muted, cursor: canSend ? 'pointer' : 'default', transition: 'background .15s' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Karta propozycji (część 2.5) — RESKIN chrome: złota ramka, nagłówek mono na tle złota 0.1,
// przyciski Zatwierdź (pełny green) / Później (ghost). Ciało = p.diff jako ostylowany tekst
// (decyzja właściciela: p.diff to freeform string — zachowujemy logikę pending_changes 1:1).
function ProposalCard({ p, onCommit, onCancel }: { p: PendingCard; onCommit: () => void; onCancel: () => void }) {
  const headerText =
    p.status === 'committed' ? 'PROPOZYCJA ZMIANY · ZATWIERDZONA' :
    p.status === 'cancelled' ? 'PROPOZYCJA ZMIANY · ODŁOŻONA' :
    p.status === 'expired' ? 'PROPOZYCJA ZMIANY · NIEAKTUALNA' :
    'PROPOZYCJA ZMIANY · CZEKA NA TWOJĄ ZGODĘ';
  return (
    <div style={{ alignSelf: 'stretch', width: '100%', border: '1px solid rgba(201,154,78,0.4)', borderRadius: 14, overflow: 'hidden', background: C.card }}>
      <div style={{ padding: '8px 14px', fontFamily: F.mono, fontSize: 9, letterSpacing: '0.1em', fontWeight: 600, color: GOLD, background: 'rgba(201,154,78,0.1)' }}>
        {headerText}
      </div>
      {/* Monospace na CAŁYM bloku — wyrównuje linie ze "→" (czysta prezentacja, bez parsowania stringa). */}
      <pre style={{ padding: '12px 14px', margin: 0, fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', fontFamily: F.mono, color: C.text }}>{p.diff}</pre>

      {p.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, padding: '2px 14px 14px' }}>
          <button
            onClick={onCommit}
            disabled={p.busy}
            style={{ flex: 1, borderRadius: 11, border: 'none', minHeight: 42, fontSize: 13, fontWeight: 700, background: C.green, color: C.bg, opacity: p.busy ? 0.5 : 1, cursor: p.busy ? 'default' : 'pointer' }}
          >
            {p.busy ? 'Zapisuję…' : 'Zatwierdź'}
          </button>
          <button
            onClick={onCancel}
            disabled={p.busy}
            style={{ flex: 1, borderRadius: 11, minHeight: 42, fontSize: 13, fontWeight: 600, background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, opacity: p.busy ? 0.5 : 1, cursor: p.busy ? 'default' : 'pointer' }}
          >
            Później
          </button>
        </div>
      )}

      {p.status === 'committed' && (
        <div style={{ padding: '2px 14px 14px', fontSize: 13, fontWeight: 600, color: C.green }}>
          ✓ Zapisano{p.resultMsg ? ` — ${p.resultMsg}` : ''}
        </div>
      )}
      {p.status === 'cancelled' && (
        <div style={{ padding: '2px 14px 14px', fontSize: 13, color: C.muted }}>Odłożone — nic nie zapisano.</div>
      )}
      {p.status === 'expired' && (
        <div style={{ padding: '2px 14px 14px', fontSize: 13, color: GOLD }}>{p.resultMsg}</div>
      )}
    </div>
  );
}

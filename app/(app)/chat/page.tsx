'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

type PendingStatus = 'pending' | 'committed' | 'cancelled' | 'expired';
interface PendingCard {
  change_id: string;
  kind: 'plan' | 'race';
  diff: string;
  status: PendingStatus;
  resultMsg?: string;
  busy?: boolean;
}
interface Message {
  role: 'user' | 'assistant';
  content: string;
  pendings?: PendingCard[];
}

const TEXTAREA_MAX = 120; // ~4 linie przy 16px; powyżej scroll wewnętrzny

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ label: string; prompt: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll do ostatniej wiadomości po wysłaniu i po odpowiedzi.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Sugerowane pytania (chips) — deterministyczne, przy montowaniu. Nice-to-have: brak → pusto.
  useEffect(() => {
    fetch('/api/ai/suggestions')
      .then((r) => r.json())
      .then((d) => setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []))
      .catch(() => setSuggestions([]));
  }, []);

  // Auto-grow textarea do TEXTAREA_MAX, potem scroll wewnętrzny.
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX)}px`;
  }

  async function sendMessage(textArg?: string) {
    const text = (typeof textArg === 'string' ? textArg : input).trim();
    if (!text || loading) return;

    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
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

  // Klik [Zatwierdź]/[Odrzuć] → BEZPOŚREDNI POST na endpoint, z pominięciem modelu (deterministyczne).
  async function handlePending(pending: PendingCard, action: 'commit' | 'cancel') {
    if (pending.busy || pending.status !== 'pending') return;
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

  const canSend = !loading && input.trim().length > 0;

  return (
    // 100vh − dolna nawigacja (5rem, pb-20 layoutu) − pionowy padding main (2rem, py-4)
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <header className="py-3 text-center border-b border-border shrink-0">
        <span className="font-bold text-sm">Chat z trenerem AI</span>
      </header>

      {/* Lista wiadomości (przewijalna nad inputem) */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-secondary text-sm text-center mt-8 mx-auto max-w-md">
            Napisz do swojego AI trenera — zapytaj o plan, formę, analizę jazdy, żywienie na trening albo przygotowanie do startu.
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                m.role === 'user'
                  ? 'self-end bg-accent text-background whitespace-pre-wrap'
                  : 'self-start bg-card border border-border text-foreground prose prose-invert prose-sm max-w-none'
              }`}
            >
              {m.role === 'user' ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
            </div>

            {m.pendings?.map((p) => (
              <ProposalCard key={p.change_id} p={p} onCommit={() => handlePending(p, 'commit')} onCancel={() => handlePending(p, 'cancel')} />
            ))}
          </div>
        ))}

        {loading && (
          <div className="self-start bg-card border border-border rounded-2xl px-4 py-3 text-sm text-secondary">
            Trener pisze…
          </div>
        )}

        {error && (
          <p className="text-center text-sm" style={{ color: '#FF4757' }}>
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Dolna strefa: chips (empty-state) + input. Tło motywu, top border, safe-area iPhone. */}
      <div
        className="shrink-0 bg-background border-t border-border"
        style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}
      >
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="px-4 pt-3 flex flex-col gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s.prompt)}
                className="bg-card border border-border rounded-xl px-4 py-2 text-sm text-left text-foreground active:opacity-70 transition-opacity flex items-center"
                style={{ minHeight: 44 }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 pt-3 flex gap-2 items-end">
          <textarea
            ref={taRef}
            className="flex-1 bg-card border border-border px-4 py-3 resize-none overflow-y-auto leading-snug"
            rows={1}
            placeholder="Napisz wiadomość…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
            // fontSize DOKŁADNIE 16px — poniżej iOS Safari zoomuje viewport przy focusie.
            style={{ fontSize: 16, minHeight: 48, maxHeight: TEXTAREA_MAX, borderRadius: 24 }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!canSend}
            aria-label="Wyślij"
            className={`shrink-0 rounded-full flex items-center justify-center transition-colors ${
              canSend ? 'bg-accent text-background' : 'bg-card border border-border text-secondary'
            }`}
            style={{ width: 44, height: 44 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Karta propozycji: diff before→after + [Zatwierdź]/[Odrzuć]. Klik działa deterministycznie
// na endpoint (bez modelu). Po rozstrzygnięciu przyciski znikają, karta pokazuje stan.
function ProposalCard({ p, onCommit, onCancel }: { p: PendingCard; onCommit: () => void; onCancel: () => void }) {
  const title = p.kind === 'plan' ? 'Proponowana zmiana planu' : 'Proponowana zmiana startu';
  return (
    <div className="self-start w-full max-w-md border border-border rounded-2xl overflow-hidden" style={{ background: 'var(--card, #1A1D23)' }}>
      <div className="px-4 py-2 text-[11px] font-semibold tracking-wide border-b border-border" style={{ color: '#4A8FC7' }}>
        {title}
      </div>
      <pre className="px-4 py-3 text-xs whitespace-pre-wrap font-sans text-foreground m-0">{p.diff}</pre>

      {p.status === 'pending' && (
        <div className="flex gap-2 px-4 pb-3 pt-1">
          <button
            onClick={onCommit}
            disabled={p.busy}
            className="flex-1 rounded-xl text-sm font-semibold text-background disabled:opacity-50"
            style={{ minHeight: 44, background: '#5B9B7E' }}
          >
            {p.busy ? 'Zapisuję…' : 'Zatwierdź'}
          </button>
          <button
            onClick={onCancel}
            disabled={p.busy}
            className="flex-1 rounded-xl text-sm font-semibold text-secondary border border-border disabled:opacity-50"
            style={{ minHeight: 44 }}
          >
            Odrzuć
          </button>
        </div>
      )}

      {p.status === 'committed' && (
        <div className="px-4 pb-3 pt-1 text-sm font-semibold" style={{ color: '#5B9B7E' }}>
          ✓ Zapisano{p.resultMsg ? ` — ${p.resultMsg}` : ''}
        </div>
      )}
      {p.status === 'cancelled' && (
        <div className="px-4 pb-3 pt-1 text-sm text-secondary">Odrzucono — nic nie zapisano.</div>
      )}
      {p.status === 'expired' && (
        <div className="px-4 pb-3 pt-1 text-sm" style={{ color: '#C99A4E' }}>{p.resultMsg}</div>
      )}
    </div>
  );
}

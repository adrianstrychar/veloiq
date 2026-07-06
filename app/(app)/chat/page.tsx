'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Błąd serwera');
        return;
      }

      setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
    } catch {
      setError('Nie udało się połączyć z serwerem');
    } finally {
      setLoading(false);
    }
  }

  // Desktop: Enter wysyła, Shift+Enter nowa linia (zachowanie zostaje, opis znika z placeholdera).
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
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
              m.role === 'user'
                ? 'self-end bg-accent text-background whitespace-pre-wrap'
                : 'self-start bg-card border border-border text-foreground prose prose-invert prose-sm max-w-none'
            }`}
          >
            {m.role === 'user' ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
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

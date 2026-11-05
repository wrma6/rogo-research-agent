import { useEffect, useId, useRef, useState } from "react";
import type { ResolvedFact } from "../answer.ts";
import type { Turn } from "../conversation.ts";
import { splitCitations } from "./citations.ts";

interface Message {
  role: "user" | "assistant";
  text: string;
  facts?: ResolvedFact[];
  /** A request that failed, which shouldn't become part of the conversation. */
  failed?: boolean;
}

/** Pairs each answer with its question, leaving out failed requests. */
function toHistory(messages: Message[]): Turn[] {
  return messages.flatMap((message, i) =>
    message.role === "assistant" && !message.failed
      ? [{ question: messages[i - 1].text, answer: message.text, facts: message.facts ?? [] }]
      : [],
  );
}

function AssistantMessage({ text, facts = [] }: { text: string; facts?: ResolvedFact[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeFact, setActiveFact] = useState<number | null>(null);
  const factId = (n: number) => `${id}-fact-${n}`;

  function showFact(n: number) {
    setOpen(true);
    setActiveFact(n);
    // Wait for the dropdown to open, so the fact has a position to scroll to.
    requestAnimationFrame(() => {
      document.getElementById(factId(n))?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  return (
    <>
      {splitCitations(text, facts.length).map((segment, i) =>
        segment.type === "text" ? (
          segment.text
        ) : (
          <sup key={i}>
            <a
              className="citation"
              href={`#${factId(segment.n)}`}
              aria-label={`Fact ${segment.n}`}
              onClick={(e) => {
                e.preventDefault();
                showFact(segment.n);
              }}
            >
              {segment.n}
            </a>
          </sup>
        ),
      )}
      {facts.length > 0 && (
        <details
          className="facts"
          open={open}
          onToggle={(e) => setOpen(e.currentTarget.open)}
        >
          <summary>Facts and references ({facts.length})</summary>
          <ol>
            {facts.map(({ claim, type, source }, i) => (
              <li key={i} id={factId(i + 1)} className={activeFact === i + 1 ? "active" : undefined}>
                <div>
                  {claim}
                  {type === "calculated" && <span className="tag">Calculated</span>}
                  {!source.verified && <span className="tag warning">Source not verified</span>}
                </div>
                {source.excerpt ? (
                  <details className="source">
                    <summary>
                      {source.label}
                      {source.date && `, ${source.date}`}
                    </summary>
                    <p>{source.excerpt}</p>
                  </details>
                ) : (
                  <div className="source">{source.label}</div>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

const EXAMPLES = [
  "Compare Acme and Globex and tell me which one appears to be growing faster.",
  "What are the biggest risks Umbrella Health flags in its filings?",
  "How is Initech's subscription transition going?",
  "Which company in the universe is growing fastest?",
];

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // The input loses focus while disabled, so give it back to make replying immediate.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  // Keep the newest message in view.
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages, busy]);

  function clearConversation() {
    setMessages([]);
    setSources([]);
    setInput("");
    inputRef.current?.focus();
  }

  async function send(question: string) {
    if (!question.trim() || busy) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history: toHistory(messages), sources }),
      });
      const data = await res.json();
      if (data.sources) setSources(data.sources);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer ?? data.error,
          facts: data.facts,
          failed: !res.ok,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Something went wrong: ${String(err)}`, failed: true },
      ]);
    }

    setBusy(false);
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Rogo Research</h1>
          <p>Ask a question about a company in our coverage universe.</p>
        </div>
        {messages.length > 0 && (
          <button type="button" className="clear" onClick={clearConversation} disabled={busy}>
            Clear conversation
          </button>
        )}
      </header>

      <div className="transcript" ref={transcriptRef}>
        {messages.length === 0 && (
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, i) => (
          <div key={i} className={`bubble ${message.role}`}>
            {message.role === "user" ? (
              message.text
            ) : (
              <AssistantMessage text={message.text} facts={message.facts} />
            )}
          </div>
        ))}

        {busy && <div className="bubble assistant pending">Thinking…</div>}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={messages.length ? "Ask a follow-up…" : "Ask a research question…"}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}

/**
 * The conversation so far. The browser holds it and sends it with each message, so
 * the server stays stateless and a page reload simply starts a new conversation.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ResolvedFact } from "./answer.ts";

/** Keeps long conversations from growing the prompt without limit. */
export const MAX_HISTORY_TURNS = 10;

export interface Turn {
  question: string;
  answer: string;
  facts: ResolvedFact[];
}

export interface Conversation {
  history: Turn[];
  /** Sources the tools returned earlier, so later answers can still cite them as verified. */
  sources: string[];
}

export const emptyConversation: Conversation = { history: [], sources: [] };

function isTurn(value: unknown): value is Turn {
  const turn = value as Partial<Turn> | null;
  return (
    typeof turn?.question === "string" &&
    typeof turn.answer === "string" &&
    Array.isArray(turn.facts) &&
    turn.facts.every(
      (fact) => typeof fact?.claim === "string" && typeof fact.source?.type === "string",
    )
  );
}

/** Reads a conversation from a request body, ignoring anything malformed. */
export function parseConversation(body: { history?: unknown; sources?: unknown }): Conversation {
  const history = Array.isArray(body.history) ? body.history.filter(isTurn) : [];
  const sources = Array.isArray(body.sources)
    ? body.sources.filter((source): source is string => typeof source === "string")
    : [];
  return { history: history.slice(-MAX_HISTORY_TURNS), sources };
}

/**
 * Past answers go back in the JSON shape the model wrote them in, including source
 * ids, so it can build on earlier facts. Raw tool results are left out to save tokens.
 */
export function historyToMessages(history: Turn[]): Anthropic.MessageParam[] {
  return history.flatMap((turn): Anthropic.MessageParam[] => [
    { role: "user", content: turn.question },
    {
      role: "assistant",
      content: JSON.stringify({
        answer: turn.answer,
        facts: turn.facts.map(({ claim, type, source }) => ({
          claim,
          type,
          sourceType: source.type,
          sourceId: source.id,
        })),
      }),
    },
  ]);
}

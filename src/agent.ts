/**
 * The research agent: a tool-use loop over the mocked research tools.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  answerFormat,
  parseAnswer,
  resolveFacts,
  sourcesFrom,
  type ResolvedFact,
} from "./answer.ts";
import { emptyConversation, historyToMessages, type Conversation } from "./conversation.ts";
import { companies } from "./data.ts";
import { executeTool, toolSchemas } from "./tools.ts";

const MODEL = process.env.ROGO_MODEL ?? "claude-sonnet-5";
const MAX_ITERATIONS = 12;

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Rogo Research, an assistant that answers questions about companies for financial analysts.

Use the tools to look up companies, profiles, financials and source documents. Answer the analyst's question.

Your job is to find and report facts, not to infer them.

Every factual claim must name its source, and you may only cite sources the tools returned during this conversation. Label your own calculations and inferences as yours.

Treat a follow-up as continuing the conversation, and resolve words like "they" or "that" from earlier turns. Numbering restarts in each answer: markers and facts refer only to the current reply.

Before concluding, draw on every kind of source that could bear on the question, and look for anything that would qualify or contradict your conclusion.

Only say information is unavailable if you looked for it. If you didn't check something, say so.

When your research is finished, summarize first: keep "answer" to at most three conversational sentences, with the conclusion first and any caveat that could change it. Put all other detail in "facts", never in "answer". After each claim in "answer", cite it with a marker like [1], numbering markers in the order you first use them. In "facts", list the fact for [1] first, then [2], and so on, then any uncited detail.

Our coverage universe:
${companies
  .map(
    (c) =>
      `- ${c.name} (${c.ticker}) — ${c.sector}, HQ ${c.hq}, ${c.employees} employees. ${c.description}`,
  )
  .join("\n")}
`;

export type AgentEvent =
  | { type: "iteration"; n: number }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_end"; name: string; ms: number }
  | { type: "tool_failed"; name: string; message: string };

export interface AgentResult {
  answer: string;
  facts: ResolvedFact[];
  /** Everything retrieved so far, to send back with the next message. */
  sources: string[];
  iterations: number;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function runAgent(
  question: string,
  onEvent: (event: AgentEvent) => void,
  conversation: Conversation = emptyConversation,
): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [
    ...historyToMessages(conversation.history),
    { role: "user", content: question },
  ];

  const retrieved = new Set(conversation.sources);
  let fallbackText = "";
  let retried = false;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    onEvent({ type: "iteration", n: iterations });

    const response = await client.messages.create({
      model: MODEL,
      // Final replies take about 1,500 tokens, so this limits how long a runaway reply can run.
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: toolSchemas,
      output_config: { format: answerFormat },
      messages,
    });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      const text = textOf(response);
      const parsed = parseAnswer(text);
      if (parsed) {
        return {
          answer: parsed.answer,
          facts: resolveFacts(parsed.facts, retrieved),
          sources: [...retrieved],
          iterations,
        };
      }
      const brokenJson = text.trimStart().startsWith("{");
      if (brokenJson && !retried) {
        retried = true;
        continue;
      }
      // Show plain text as is, but never broken JSON.
      fallbackText = brokenJson ? "" : text;
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    // Promise.all keeps results in request order, whichever tool finishes first.
    const toolResults = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        const startedAt = Date.now();
        onEvent({ type: "tool_start", name: use.name, input: use.input });

        let content: string;
        let isError = false;
        try {
          const output = await executeTool(use.name, use.input as Record<string, unknown>);
          content = JSON.stringify(output);
          for (const source of sourcesFrom(use.name, output)) retrieved.add(source);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          content = `${use.name} failed: ${message}`;
          isError = true;
          onEvent({ type: "tool_failed", name: use.name, message });
        }

        onEvent({ type: "tool_end", name: use.name, ms: Date.now() - startedAt });
        return { type: "tool_result", tool_use_id: use.id, content, is_error: isError };
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  return {
    answer:
      fallbackText ||
      "I looked at a number of sources but couldn't pull an answer together. Try asking a narrower question.",
    facts: [],
    sources: [...retrieved],
    iterations,
  };
}

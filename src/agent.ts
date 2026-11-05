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
import { companies } from "./data.ts";
import { executeTool, toolSchemas } from "./tools.ts";

const MODEL = process.env.ROGO_MODEL ?? "claude-sonnet-5";
const MAX_ITERATIONS = 12;

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Rogo Research, an assistant that answers questions about companies for financial analysts.

Use the tools to look up companies, profiles, financials and source documents. Answer the analyst's question.

Your job is to find and report facts, not to infer them.

Every factual claim must name its source, and you may only cite sources the tools returned while answering this question. Label your own calculations and inferences as yours.

Before concluding, draw on every kind of source that could bear on the question, and look for anything that would qualify or contradict your conclusion.

Only say information is unavailable if you looked for it. If you didn't check something, say so.

When your research is finished, summarize first: keep "answer" to at most three conversational sentences, with the conclusion first and any caveat that could change it. Put all other detail in "facts", never in "answer".

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
): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  const retrieved = new Set<string>();
  let fallbackText = "";
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    onEvent({ type: "iteration", n: iterations });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: toolSchemas,
      output_config: { format: answerFormat },
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

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
          iterations,
        };
      }
      // Show plain text as is, but never raw JSON from a reply that was cut off.
      fallbackText = text.trimStart().startsWith("{") ? "" : text;
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const use of toolUses) {
      const startedAt = Date.now();
      onEvent({ type: "tool_start", name: use.name, input: use.input });

      let content: string;
      try {
        const output = await executeTool(use.name, use.input as Record<string, unknown>);
        content = JSON.stringify(output);
        for (const source of sourcesFrom(use.name, output)) retrieved.add(source);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        content = `${use.name} returned: ${message}`;
        onEvent({ type: "tool_failed", name: use.name, message });
      }

      onEvent({ type: "tool_end", name: use.name, ms: Date.now() - startedAt });
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    answer:
      fallbackText ||
      "I looked at a number of sources but couldn't pull an answer together. Try asking a narrower question.",
    facts: [],
    iterations,
  };
}

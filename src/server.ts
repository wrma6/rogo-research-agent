import "dotenv/config";
import express from "express";
import { runAgent } from "./agent.ts";
import { parseConversation } from "./conversation.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\nANTHROPIC_API_KEY is not set.\nCopy .env.example to .env and add your key, then run `npm run dev` again.\n",
  );
  process.exit(1);
}

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const message = String(req.body.message ?? "");
  const conversation = parseConversation(req.body);
  console.log(`\n[chat] ${message} (${conversation.history.length} earlier turns)`);

  try {
    const onEvent: Parameters<typeof runAgent>[1] = (event) => {
      switch (event.type) {
        case "iteration":
          console.log(`[agent] iteration ${event.n}`);
          break;
        case "tool_start":
          console.log(`[tool]  → ${event.name} ${JSON.stringify(event.input)}`);
          break;
        case "tool_end":
          console.log(`[tool]  ← ${event.name} (${event.ms}ms)`);
          break;
        case "tool_failed":
          console.log(`[tool]  ! ${event.name}: ${event.message}`);
          break;
      }
    };
    const result = await runAgent(message, onEvent, conversation);

    const unverified = result.facts.filter((fact) => !fact.source.verified).length;
    console.log(`[agent] answered: ${result.facts.length} facts, ${unverified} unverified`);

    res.json({ answer: result.answer, facts: result.facts, sources: result.sources });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Agent server listening on http://localhost:${port}`);
});

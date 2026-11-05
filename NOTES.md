# Notes

- [CORRECTNESS] Added generic prompt rules so the agent looks for and reports sourced facts rather than inferring them, because answers were skipping documents and missing facts that change the conclusion ([src/agent.ts:26-34](src/agent.ts#L26-L34)).
- [CORRECTNESS] [UX] Replaced the editor pass with one structured reply, a summary of up to three sentences plus an expandable list of facts with sources checked in code, because the rewrite cut source mentions by about half and answers were too long to scan (median 1,980 to 535 characters, with time and cost about flat) ([src/agent.ts:93](src/agent.ts#L93), [src/answer.ts:107](src/answer.ts#L107)).
- [EFFICIENCY] Ran each batch of tool calls in parallel, because waiting on them one at a time was avoidable latency (tool wait about 52% lower, roughly 2s per question across 12 runs) ([src/agent.ts:124-125](src/agent.ts#L124-L125)).
- [UX] [RELIABILITY] Added footnote links from the summary to its facts, so an analyst can check a claim in one click, and retry once on a broken reply because structured output occasionally failed ([src/ui/App.tsx:29](src/ui/App.tsx#L29), [src/agent.ts:113](src/agent.ts#L113)).

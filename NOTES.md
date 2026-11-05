# Notes

- [CORRECTNESS] Added generic prompt rules so the agent looks for and reports sourced facts rather than inferring them, because answers were skipping documents and missing facts that change the conclusion ([src/agent.ts:26-34](src/agent.ts#L26-L34)).

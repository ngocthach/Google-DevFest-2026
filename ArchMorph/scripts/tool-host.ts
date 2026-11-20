// JSON-lines host for the real ArchMorph WebMCP tools, so Python bridge logic can be tested without a browser.
// Request: {"name": tool | "__reset__" | "__state__", "args": {...}}  Response: tool result or {status:"error"}.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { applyOperation, migrateProject, roomArea } from "../src/lib/architecture.ts";
import { createArchMorphTools } from "../src/lib/webmcp-tools.ts";
import { assertNoNewDesignIssues } from "../src/lib/agent-room-layout.ts";

const fixture = migrateProject(JSON.parse(readFileSync(new URL("../public/demo-fixtures/sukoon-studio-demo.archmorph.json", import.meta.url), "utf8")).project);
let project = fixture;
const tools = createArchMorphTools({
  getProject: () => project,
  // Mirror Studio.tsx: every agent edit is rejected if it introduces new layout errors.
  perform: operation => { const outcome = applyOperation(project, operation, "agent"); assertNoNewDesignIssues(project, outcome.project); project = outcome.project; return outcome; },
  captureSnapshot: async () => ({}),
  exportPlan: () => ({}),
  noteActivity: () => {},
});

for await (const line of createInterface({ input: process.stdin })) {
  const { name, args = {} } = JSON.parse(line);
  let result: unknown;
  try {
    if (name === "__reset__") { project = fixture; result = { version: project.version }; }
    else if (name === "__state__") result = { version: project.version, rooms: Object.fromEntries(project.rooms.map(r => [r.name, { id: r.id, area: roomArea(r) }])) };
    else {
      const tool = tools.find(t => t.name === name);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`);
      // Mirror the browser: native WebMCP wraps results as MCP text content blocks.
      result = { content: [{ type: "text", text: JSON.stringify(await tool.execute(args)) }] };
    }
  } catch (error) {
    result = { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}

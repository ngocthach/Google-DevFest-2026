import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyOperation, migrateProject, roomArea, validateLayout } from "../src/lib/architecture.ts";
import { createArchMorphTools } from "../src/lib/webmcp-tools.ts";

const fixture = migrateProject(JSON.parse(readFileSync(new URL("../public/demo-fixtures/sukoon-studio-demo.archmorph.json", import.meta.url), "utf8")).project);
let project = fixture;
const tools = createArchMorphTools({
  getProject: () => project,
  perform: operation => {
    const outcome = applyOperation(project, operation, "agent");
    project = outcome.project;
    return outcome;
  },
  captureSnapshot: async () => ({}),
  exportPlan: () => ({}),
  noteActivity: () => {},
});
const call = (name: string, args: Record<string, unknown>) => tools.find(tool => tool.name === name)!.execute(args);
const guest = project.rooms.find(room => room.name === "Guest Lounge")!;
const garden = project.rooms.find(room => room.name === "Garden Study")!;
const blocked = { expectedVersion: project.version, changes: [{ tool: "resize_room", input: { roomId: garden.id, width: 16, length: 8 } }] };
assert.throws(() => call("apply_changes", blocked), /SETBACK_VIOLATION/);
assert.equal(project, fixture);

const proposal = await call("propose_room_layout", { roomId: guest.id, goal: "rebalance", areaPercent: 20, neighborRoomId: garden.id }) as {
  options: { expectedVersion: number; changes: unknown[] }[];
  alternatives: { expectedVersion: number; changes: unknown[] }[];
  blockers: string[];
};
assert.equal(project, fixture, "preview must not save");
assert.ok(proposal.options.length === 0 && proposal.blockers.some(x => x.includes("UPPER_FLOOR_BASE_UNVERIFIED")));
const alternative = proposal.alternatives[0];
assert.ok(alternative, "the Garden Study should have a validated independent expansion");
const invalid = { expectedVersion: project.version - 1, changes: alternative.changes };
assert.throws(() => call("apply_changes", invalid), /design changed/i);
call("apply_changes", { expectedVersion: alternative.expectedVersion, changes: alternative.changes });
assert.equal(project.version, fixture.version + 1);
assert.equal(roomArea(project.rooms.find(room => room.id === guest.id)!), 224);
assert.equal(roomArea(project.rooms.find(room => room.id === garden.id)!), 142.05);
assert.equal(validateLayout(project).issueCount, 0);
console.log("PASS: rebalance preview finds blockers, Garden alternative saves once, and stale or invalid batches are rejected");

project = fixture;
call("apply_changes", { expectedVersion: project.version, changes: [
  { tool: "create_room", input: { floorId: "floor-e0df61af", name: "Creative Studio", roomType: "Office", x: 6, y: 50, width: 10, length: 12 } },
  { tool: "add_door", input: { wallId: "wall-floor-e0df61af-h-5000-600-1600", offset: 2, width: 3 } },
  { tool: "add_window", input: { wallId: "wall-floor-e0df61af-v-600-5000-6200", offset: 2, width: 4, windowType: "casement" } },
] });
assert.equal(project.version, fixture.version + 1);
assert.equal(validateLayout(project).issueCount, 0, "the full stage demo must pass as one transaction");

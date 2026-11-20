import { roomArea, roomContainsPoint, sharedRoomBoundary, stairEntryPoint, validateLayout, type Project, type Room } from "./architecture.ts";

export type DesignChange = { tool: string; input: Record<string, unknown> };

export function newDesignIssues(before: ReturnType<typeof validateLayout>, after: ReturnType<typeof validateLayout>) {
  const relevant = (issue: (typeof before.issues)[number]) =>
    issue.severity === "error" || issue.code === "UPPER_FLOOR_BASE_UNVERIFIED";
  const key = (issue: (typeof before.issues)[number], id: string) => `${issue.code}:${id}`;
  const baseline = new Map(before.issues.filter(relevant).flatMap(issue =>
    (issue.elementIds.length ? issue.elementIds : [""]).map(id => [key(issue, id), issue] as const),
  ));
  return after.issues.filter(issue => relevant(issue) &&
    (issue.elementIds.length ? issue.elementIds : [""]).some(id => {
      const previous = baseline.get(key(issue, id));
      return !previous || previous.severity !== issue.severity ||
        (issue.code === "UPPER_FLOOR_BASE_UNVERIFIED" &&
          Number(issue.evidence.uncoveredArea) > Number(previous.evidence.uncoveredArea) + 0.05);
    }));
}

export function assertNoNewDesignIssues(before: Project, after: Project) {
  const issues = newDesignIssues(validateLayout(before), validateLayout(after));
  if (issues.length) throw new Error(`New layout findings: ${issues.map(issue => `${issue.code}: ${issue.message}`).join(" ")}`);
}

export function proposeRoomLayout(
  project: Project,
  input: { roomId: string; goal: string; areaPercent: number; neighborRoomId?: string },
  preview: (changes: DesignChange[]) => { draft: Project },
) {
  const room = project.rooms.find(item => item.id === input.roomId);
  const neighbor = project.rooms.find(item => item.id === input.neighborRoomId);
  if (!room || (input.goal === "rebalance" && (!neighbor || room.id === neighbor.id || room.floorId !== neighbor.floorId))) {
    throw new Error("Choose distinct inspected rooms on the same floor for a rebalance.");
  }
  const baseline = validateLayout(project);
  const anchors = ["north-west", "north-east", "south-west", "south-east"];
  const resize = (target: typeof room, factor: number) =>
    [[factor, 1], [1, factor], [Math.sqrt(factor), Math.sqrt(factor)]].flatMap(([width, length]) =>
      anchors.map(anchor => ({ tool: "resize_room", input: { roomId: target.id, width: target.width * width, length: target.length * length, anchor } })));
  const targets = neighbor && input.goal === "rebalance" ? [room, neighbor] : [room];
  const blocked = new Set<string>();
  function feasible(candidates: DesignChange[][]) {
    const options = [];
    const seen = new Set<string>();
    for (const changes of candidates) {
      try {
        const { draft } = preview(changes);
        const report = validateLayout(draft);
        const findings = newDesignIssues(baseline, report);
        if (findings.length) {
          findings.forEach(issue => blocked.add(`${issue.code}: ${issue.message}`));
          continue;
        }
        const affectedRooms = targets.map(before => {
          const after = draft.rooms.find(item => item.id === before.id)!;
          return { name: before.name, beforeArea: roomArea(before), afterArea: roomArea(after),
            x: after.x, y: after.y, width: after.width, length: after.length };
        });
        const signature = JSON.stringify(affectedRooms);
        if (seen.has(signature) || !affectedRooms.some((after, i) => {
          const before = targets[i];
          return after.x !== before.x || after.y !== before.y || after.width !== before.width || after.length !== before.length;
        })) continue;
        seen.add(signature);
        options.push({ expectedVersion: project.version, changes, affectedRooms, errors: report.errors, warnings: report.warnings });
        if (options.length === 3) break;
      } catch (error) {
        blocked.add(error instanceof Error ? error.message : String(error));
      }
    }
    return options;
  }

  const percent = input.areaPercent / 100;
  let options;
  let alternatives: ReturnType<typeof feasible> = [];
  if (input.goal === "move") {
    const peers = project.rooms.filter(item => item.floorId === room.floorId && item.id !== room.id);
    const coordinates = (start: number, size: number, limit: number, edges: number[]) =>
      [...new Set([start, start - 2, start + 2, start - 5, start + 5, 0, limit - size,
        ...edges.flatMap(edge => [edge, edge - size])])].filter(value => value >= 0 && value + size <= limit);
    const xs = coordinates(room.x, room.width, project.plot.width, peers.flatMap(item => [item.x, item.x + item.width]));
    const ys = coordinates(room.y, room.length, project.plot.length, peers.flatMap(item => [item.y, item.y + item.length]));
    const positions = xs.flatMap(x => ys.map(y => ({ x, y }))).filter(({ x, y }) => (x !== room.x || y !== room.y) &&
      !peers.some(item => x < item.x + item.width && x + room.width > item.x && y < item.y + item.length && y + room.length > item.y));
    positions.sort((a, b) => Math.hypot(a.x - room.x, a.y - room.y) - Math.hypot(b.x - room.x, b.y - room.y));
    options = feasible(positions.slice(0, 64).map(position => [{ tool: "move_room", input: { roomId: room.id, ...position } }]));
  } else if (input.goal === "rebalance" && neighbor) {
    const boundary = sharedRoomBoundary(project, room.id, neighbor.id);
    const transfer = roomArea(room) * percent;
    const { width, length, setbacks } = project.plot;
    const grows = [1, 0.75, 0.5, 0.25].flatMap(scale => resize(neighbor, 1 + transfer * scale / roomArea(neighbor)))
      .map(change => {
        const { anchor } = change.input;
        const maxWidth = anchor.endsWith("east") ? neighbor.x + neighbor.width - setbacks.left : width - setbacks.right - neighbor.x;
        const maxLength = anchor.startsWith("south") ? neighbor.y + neighbor.length - setbacks.front : length - setbacks.rear - neighbor.y;
        return { ...change, input: { ...change.input, width: Math.min(change.input.width, Math.max(neighbor.width, maxWidth)),
          length: Math.min(change.input.length, Math.max(neighbor.length, maxLength)) } };
      })
      .sort((a, b) => b.input.width * b.input.length - a.input.width * a.input.length);
    const shrinks = resize(room, 1 - percent);
    const single = feasible(shrinks.map(change => [change]));
    const shared = boundary ? [[{ tool: "adjust_shared_boundary", input: {
      roomId: room.id, neighborRoomId: neighbor.id,
      position: boundary.position + (boundary.first.id === room.id ? -1 : 1) * transfer /
        (boundary.axis === "x" ? room.length : room.width),
    } }]] : [];
    options = feasible([...shared, ...single.flatMap(({ changes }) => grows.map(grow => [...changes, grow]))]);
    if (!options.length) alternatives = feasible(grows.map(change => [change]));
  } else {
    options = feasible(resize(room, 1 + (input.goal === "shrink" ? -percent : percent)).map(change => [change]));
  }
  return { baseVersion: project.version, areaUnit: "square feet", spokenAreaUnitVi: "feet vuông",
    status: options.length ? "preview_ready" : "no_complete_plan",
    options, alternatives, blockers: [...blocked].slice(0, 8) };
}

type DraftPreview = { draft: Project; outputs: unknown[] };
type RequestedRoom = { name: string; roomType: string };

const DEFAULT_UPPER_ROOMS: RequestedRoom[] = [
  { name: "Master Bedroom", roomType: "Bedroom" },
  { name: "Bedroom 2", roomType: "Bedroom" },
  { name: "Study", roomType: "Office" },
  { name: "Family Lounge", roomType: "Living Room" },
];

/**
 * Plan rooms for an empty upper floor as ONE atomic batch.
 * Individually, an upper room is rejected as disconnected and a stair as landing nowhere, so the
 * planner stacks a copy of the existing stair, adds a landing room above it, places rooms directly
 * over lower-floor rooms (always inside the modeled footprint) and connects each with a door.
 */
export function proposeFloorRooms(
  project: Project,
  input: { floorId: string; rooms?: RequestedRoom[]; roomCount?: number; fill?: boolean },
  preview: (changes: DesignChange[]) => DraftPreview,
) {
  const floors = [...project.floors].sort((a, b) => a.level - b.level);
  const target = floors.find(floor => floor.id === input.floorId);
  if (!target) throw new Error("Unknown floorId. Inspect the project, or call create_floor first and use its floor ID.");
  const below = floors.find(floor => floor.level === target.level - 1);
  const base = { baseVersion: project.version, areaUnit: "square feet", spokenAreaUnitVi: "feet vuông", alternatives: [] as unknown[] };
  if (!below) return { ...base, status: "no_complete_plan", options: [], blockers: ["The ground floor has no floor below it; place rooms on it with create_room."] };
  if (project.rooms.some(room => room.floorId === target.id)) return extendFloorRooms(project, target, below, input, preview);
  const requested = (input.rooms?.length ? input.rooms : DEFAULT_UPPER_ROOMS.slice(0, Math.max(1, Math.min(4, Math.round(input.roomCount ?? 2)))))
    .map(room => ({ name: room.name.trim(), roomType: room.roomType }));
  // Stairs that arrive on the floor below can be stacked one storey higher with an aligned stairwell.
  const templates = project.stairs.filter(stair => {
    const source = floors.find(floor => floor.id === stair.floorId);
    return source && (stair.direction === "up" ? source.level + 1 === below.level : source.level - 1 === below.level);
  });
  if (!templates.length) {
    return { ...base, status: "no_complete_plan", options: [], blockers: [`No stair reaches ${below.name}, so there is no stair to stack. Add a stair on ${below.name} manually first.`] };
  }
  const baseline = validateLayout(project);
  const blocked = new Set<string>();
  const lowerRooms = project.rooms.filter(room => room.floorId === below.id && (room.shape ?? "rectangle") === "rectangle" && !room.vertices);
  const neighbours = (room: Room) => {
    const ids = new Set(project.walls.filter(wall => wall.floorId === below.id && wall.roomIds.includes(room.id)).flatMap(wall => wall.roomIds));
    return lowerRooms.filter(other => other.id !== room.id && ids.has(other.id)).sort((a, b) => roomArea(b) - roomArea(a));
  };
  const rect = (room: Room) => ({ x: room.x, y: room.y, width: room.width, length: room.length });

  for (const template of templates) {
    const stairInput: Record<string, unknown> = {
      floorId: below.id, direction: "up", x: template.x, y: template.y, width: template.width, length: template.length,
      rotation: template.rotation, stairType: template.stairType, landingDepth: template.landingDepth,
      wellWidth: template.wellWidth, turnSide: template.turnSide,
      ...(template.stairType === "l-shaped" ? { upperFlightLength: template.upperFlightLength } : {}),
    };
    const stairCopy = { ...template, floorId: below.id, direction: "up" as const };
    const entries = [stairEntryPoint(stairCopy, "lower"), stairEntryPoint(stairCopy, "upper")];
    const landingCandidates = lowerRooms
      .filter(room => entries.some(point => roomContainsPoint(room, point)))
      .concat(lowerRooms.filter(room => !entries.some(point => roomContainsPoint(room, point))))
      .slice(0, 6);
    for (const landing of landingCandidates) {
      const spots = neighbours(landing);
      for (let count = Math.min(requested.length, spots.length); count >= 1; count--) {
        const rooms = requested.slice(0, count);
        const phase1: DesignChange[] = [
          { tool: "create_room", input: { floorId: target.id, name: "Upper Landing", roomType: "Custom", ...rect(landing) } },
          { tool: "add_stairs", input: stairInput },
          ...rooms.map((room, index) => ({ tool: "create_room", input: { floorId: target.id, name: room.name, roomType: room.roomType, ...rect(spots[index]) } })),
        ];
        let drafted: DraftPreview;
        try { drafted = preview(phase1); }
        catch (error) { blocked.add(error instanceof Error ? error.message : String(error)); continue; }
        const createdId = (step: number) => (drafted.outputs[step] as { room?: { id: string } })?.room?.id;
        const landingId = createdId(0);
        const doorWalls = rooms.map((_, index) => {
          const roomId = createdId(index + 2);
          return drafted.draft.walls.filter(wall => wall.floorId === target.id && landingId && roomId && wall.roomIds.includes(landingId) && wall.roomIds.includes(roomId))
            .sort((a, b) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1) - Math.hypot(a.x2 - a.x1, a.y2 - a.y1))[0];
        });
        if (doorWalls.some(wall => !wall)) { blocked.add("A planned room does not share a wall with the landing."); continue; }
        for (const placement of ["center", "start", "end"] as const) {
          const doors = doorWalls.map(wall => {
            const length = Math.hypot(wall!.x2 - wall!.x1, wall!.y2 - wall!.y1);
            const offset = placement === "center" ? length / 2 : placement === "start" ? Math.min(2.5, length / 2) : Math.max(length / 2, length - 2.5);
            return { tool: "add_door", input: { wallId: wall!.id, offset: Math.round(offset * 100) / 100, width: 3 } };
          });
          const changes = [...phase1, ...doors];
          try {
            const { draft } = preview(changes);
            const report = validateLayout(draft);
            const findings = newDesignIssues(baseline, report);
            if (findings.length) { findings.forEach(issue => blocked.add(`${issue.code}: ${issue.message}`)); continue; }
            const affectedRooms = [{ name: "Upper Landing", ...rect(landing) }, ...rooms.map((room, index) => ({ name: room.name, ...rect(spots[index]) }))]
              .map(room => ({ ...room, beforeArea: 0, afterArea: Math.round(room.width * room.length * 100) / 100 }));
            const skipped = requested.slice(count).map(room => room.name);
            return { ...base, status: "preview_ready", floor: { id: target.id, name: target.name }, options: [{
              expectedVersion: project.version, changes, affectedRooms, newRooms: true,
              stair: { floorId: below.id, from: below.name, to: target.name, x: template.x, y: template.y, stairType: template.stairType, stackedOver: template.id },
              skippedRooms: skipped, errors: report.errors, warnings: report.warnings,
            }], blockers: skipped.length ? [`Only ${count} of ${requested.length} rooms fit over rooms next to the stair landing.`] : [] };
          } catch (error) {
            blocked.add(error instanceof Error ? error.message : String(error));
          }
        }
      }
    }
  }
  return { ...base, status: "no_complete_plan", options: [], blockers: [...blocked].slice(0, 8) };
}

type Rect = { x: number; y: number; width: number; length: number };
const r2 = (value: number) => Math.round(value * 100) / 100;
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.length, b.y + b.length) - Math.max(a.y, b.y));
// Two rectangles touch along an edge long enough for a 3 ft door.
const touches = (a: Rect, b: Rect) => {
  const near = (p: number, q: number) => Math.abs(p - q) < 0.05;
  const span = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1);
  return ((near(a.x + a.width, b.x) || near(b.x + b.width, a.x)) && span(a.y, a.y + a.length, b.y, b.y + b.length) >= 3.5) ||
    ((near(a.y + a.length, b.y) || near(b.y + b.length, a.y)) && span(a.x, a.x + a.width, b.x, b.x + b.width) >= 3.5);
};

/**
 * Free space on an upper floor: lower-floor rooms that no room on this floor covers yet. Each spot can hold a room
 * fully inside the footprint below. Sides are plan-view (x grows to the right, y grows downward on screen).
 */
export function floorFreeSpace(project: Project, floorId: string) {
  const floors = [...project.floors].sort((a, b) => a.level - b.level);
  const target = floors.find(floor => floor.id === floorId);
  if (!target) throw new Error("Unknown floorId. Inspect the project and use a floor ID from it.");
  const below = floors.find(floor => floor.level === target.level - 1);
  const used = project.rooms.filter(room => room.floorId === target.id);
  const usedArea = r2(used.reduce((sum, room) => sum + roomArea(room), 0));
  if (!below) return { floor: { id: target.id, name: target.name }, areaUnit: "square feet", usedArea, freeSpots: [], note: "Ground floor: free space is limited by the site, not a floor below." };
  const lower = project.rooms.filter(room => room.floorId === below.id && room.type !== "Courtyard" && (room.shape ?? "rectangle") === "rectangle" && !room.vertices);
  const footprintArea = r2(lower.reduce((sum, room) => sum + roomArea(room), 0));
  const minX = Math.min(...lower.map(room => room.x)), maxX = Math.max(...lower.map(room => room.x + room.width));
  const minY = Math.min(...lower.map(room => room.y)), maxY = Math.max(...lower.map(room => room.y + room.length));
  const box = { minX, maxX, minY, maxY };
  const freeSpots = lower
    .filter(room => used.every(upper => overlapArea(room, upper) < 0.5))
    .map(room => {
      const rect = { x: room.x, y: room.y, width: room.width, length: room.length };
      const { key, vi } = sideOf(rect, box);
      return { ...rect, area: r2(roomArea(room)), above: room.name, side: key, sideVi: vi,
        touchesUpperRooms: used.filter(upper => touches(rect, upper)).map(upper => upper.name) };
    })
    .sort((a, b) => b.area - a.area);
  const freeArea = r2(freeSpots.reduce((sum, spot) => sum + spot.area, 0));
  const bySide = freeSpots.reduce<Record<string, number>>((acc, spot) => {
    for (const part of spot.side.split("-")) acc[part] = r2((acc[part] ?? 0) + spot.area);
    return acc;
  }, {});
  return { floor: { id: target.id, name: target.name }, floorBelow: { id: below.id, name: below.name }, areaUnit: "square feet", spokenAreaUnitVi: "feet vuông",
    footprintBelowArea: footprintArea, footprintBox: box, usedArea, freeArea, freeAreaBySide: bySide, freeSpots,
    note: "Free spots are lower-floor rooms not yet covered on this floor. Use propose_floor_rooms to fill them." };
}

// Merge free spots that together form one rectangle (e.g. two 7×6 rooms below → one 14×6 spot).
function mergeSpots(spots: Rect[]) {
  const near = (p: number, q: number) => Math.abs(p - q) < 0.05;
  const list = spots.map(spot => ({ x: spot.x, y: spot.y, width: spot.width, length: spot.length }));
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      const a = list[i], b = list[j];
      // Only absorb small leftovers; two real rooms below stay separate spots.
      if (i === j || Math.max(a.width * a.length, b.width * b.length) >= 60) continue;
      if (near(a.y, b.y) && near(a.length, b.length) && near(a.x + a.width, b.x)) list[i] = { ...a, width: a.width + b.width };
      else if (near(a.x, b.x) && near(a.width, b.width) && near(a.y + a.length, b.y)) list[i] = { ...a, length: a.length + b.length };
      else continue;
      list.splice(j, 1); merged = true; break outer;
    }
  }
  return list;
}

/**
 * Add rooms to an upper floor that already has rooms. Rooms are placed one at a time over free lower-floor space,
 * each with a door to a room that is already connected, and every step is validated before the next room is tried.
 */
function extendFloorRooms(
  project: Project,
  target: { id: string; name: string },
  below: { id: string; name: string },
  input: { rooms?: RequestedRoom[]; roomCount?: number; fill?: boolean },
  preview: (changes: DesignChange[]) => DraftPreview,
) {
  const base = { baseVersion: project.version, areaUnit: "square feet", spokenAreaUnitVi: "feet vuông", alternatives: [] as unknown[] };
  const space = floorFreeSpace(project, target.id);
  const merged = mergeSpots(space.freeSpots);
  const spots = merged.filter(spot => Math.min(spot.width, spot.length) >= 5).sort((a, b) => b.width * b.length - a.width * a.length);
  // Strips 3.5–5 ft wide are too narrow for a room but can become a hall that reaches spots further away.
  const strips = merged.filter(spot => Math.min(spot.width, spot.length) >= 3.5 && Math.min(spot.width, spot.length) < 5);
  if (!spots.length) return { ...base, status: "no_complete_plan", options: [], space, blockers: [`${target.name} has no free space left over the floor below that is at least 5 ft wide.`] };
  const existing = new Set(project.rooms.map(room => room.name.toLowerCase()));
  const defaults = [...DEFAULT_UPPER_ROOMS, { name: "Family Room", roomType: "Living Room" }, { name: "Guest Bedroom", roomType: "Bedroom" },
    { name: "Hobby Room", roomType: "Custom" }, { name: "Storage", roomType: "Storage" }]
    .filter(room => !existing.has(room.name.toLowerCase()) && !input.rooms?.some(asked => asked.name.toLowerCase() === room.name.toLowerCase()));
  const asked = (input.rooms ?? []).map(room => ({ name: room.name.trim(), roomType: room.roomType }));
  const extra = input.fill ? spots.length : asked.length ? 0 : Math.max(1, Math.round(input.roomCount ?? 2));
  const requested = [...asked, ...defaults.slice(0, Math.max(0, extra - asked.length))].slice(0, 8);
  const sideAt = (rect: Rect) => "footprintBox" in space && space.footprintBox ? sideOf(rect, space.footprintBox).vi : "";
  const baseline = validateLayout(project);
  const blocked = new Set<string>();
  const accepted: DesignChange[] = [];
  const connected: { rect: Rect; ref: string; step?: number; name: string }[] = project.rooms
    .filter(room => room.floorId === target.id).map(room => ({ rect: room, ref: room.id, name: room.name }));
  const free = [...spots];
  const placed: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  let lastReport: ReturnType<typeof validateLayout> | undefined;

  const place = (room: RequestedRoom, pool: Rect[]) => {
    for (const spot of pool.filter(candidate => connected.some(item => touches(candidate, item.rect)))) {
      const create: DesignChange = { tool: "create_room", input: { floorId: target.id, name: room.name, roomType: room.roomType, ...spot } };
      let drafted: DraftPreview;
      try { drafted = preview([...accepted, create]); }
      catch (error) { blocked.add(error instanceof Error ? error.message : String(error)); continue; }
      const idAt = (step: number) => (drafted.outputs[step] as { room?: { id: string } })?.room?.id;
      const newId = idAt(accepted.length);
      for (const neighbour of connected.filter(item => touches(spot, item.rect))) {
        const otherId = neighbour.step === undefined ? neighbour.ref : idAt(neighbour.step);
        const wall = drafted.draft.walls.filter(w => w.floorId === target.id && newId && otherId && w.roomIds.includes(newId) && w.roomIds.includes(otherId))
          .sort((p, q) => Math.hypot(q.x2 - q.x1, q.y2 - q.y1) - Math.hypot(p.x2 - p.x1, p.y2 - p.y1))[0];
        if (!wall) continue;
        const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
        for (const offset of [length / 2, Math.min(2.5, length / 2), Math.max(length / 2, length - 2.5)]) {
          const door: DesignChange = { tool: "add_door", input: { wallId: wall.id, offset: r2(offset), width: 3 } };
          try {
            const { draft } = preview([...accepted, create, door]);
            const report = validateLayout(draft);
            const findings = newDesignIssues(baseline, report);
            if (findings.length) { findings.forEach(issue => blocked.add(`${issue.code}: ${issue.message}`)); continue; }
            connected.push({ rect: spot, ref: room.name, step: accepted.length, name: room.name });
            accepted.push(create, door);
            pool.splice(pool.indexOf(spot), 1);
            lastReport = report;
            placed.push({ name: room.name, roomType: room.roomType, ...spot, side: sideAt(spot), beforeArea: 0, afterArea: r2(spot.width * spot.length), doorTo: neighbour.name });
            return true;
          } catch (error) { blocked.add(error instanceof Error ? error.message : String(error)); }
        }
      }
    }
    return false;
  };
  let pending = requested.filter(room => !place(room, free));
  // Rooms that could not reach a connected room: open a hall on a narrow strip, then try them again.
  while (pending.length && strips.length && free.length) {
    const halls = placed.length;
    if (!place({ name: placed.some(item => item.name === "Upper Hall") ? `Upper Hall ${halls}` : "Upper Hall", roomType: "Custom" }, strips)) break;
    pending = pending.filter(room => !place(room, free));
  }
  skipped.push(...pending.map(room => room.name));
  if (!placed.length || !lastReport) return { ...base, status: "no_complete_plan", options: [], space,
    blockers: blocked.size ? [...blocked].slice(0, 8) : [`No free spot on ${target.name} touches a connected room, so a new room could not get a door.`] };
  const remaining = free.map(spot => ({ ...spot, area: r2(spot.width * spot.length), side: sideAt(spot) }));
  return { ...base, status: "preview_ready", mode: "extend", floor: { id: target.id, name: target.name }, options: [{
    expectedVersion: project.version, changes: accepted, affectedRooms: placed, newRooms: true, stair: null,
    skippedRooms: skipped, errors: lastReport.errors, warnings: lastReport.warnings,
  }], freeAreaBefore: space.freeArea, freeAreaAfter: r2(remaining.reduce((sum, spot) => sum + spot.area, 0)), remainingFreeSpots: remaining,
  blockers: skipped.length ? [`Could not place ${skipped.join(", ")}: no remaining free spot connects to ${target.name}'s rooms.`] : [] };
}

function sideOf(rect: Rect, box: { minX: number; maxX: number; minY: number; maxY: number }) {
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  const dx = rect.x + rect.width / 2 - cx, dy = rect.y + rect.length / 2 - cy;
  const h = dx > (box.maxX - box.minX) / 6 ? "right" : dx < -(box.maxX - box.minX) / 6 ? "left" : "";
  const v = dy > (box.maxY - box.minY) / 6 ? "bottom" : dy < -(box.maxY - box.minY) / 6 ? "top" : "";
  const vi: Record<string, string> = { left: "bên trái", right: "bên phải", top: "phía trên", bottom: "phía dưới" };
  const key = [v, h].filter(Boolean).join("-") || "center";
  return { key, vi: key === "center" ? "ở giữa" : key.split("-").map(part => vi[part]).join(" ") };
}

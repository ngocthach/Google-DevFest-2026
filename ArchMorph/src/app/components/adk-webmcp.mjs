function groupFor(name) {
  if (/^(inspect|calculate|measure|validate|preview|propose)_/.test(name)) return 'inspect';
  if (name === 'apply_changes') return 'layout';
  if (/(room|wall|floor)/.test(name) && !/(finish)/.test(name)) return 'layout';
  if (/(door|window|opening|stair)/.test(name)) return 'connections';
  if (/^(switch_view|set_camera|set_navigation_mode|focus_element|take_snapshot|export_plan)$/.test(name)) return 'presentation';
  return 'site';
}

// Chat and microphone sessions execute the same native tools in the active tab.
export async function executeArchMorphRequest(name, args, log) {
  const api = document.modelContext;
  if (!api?.getTools || !api.executeTool) throw new Error('Native WebMCP is unavailable in this browser.');
  const tools = await api.getTools();
  if (name === '__discover__') {
    if (args.name) {
      const tool = tools.find(item => item.name === args.name);
      return tool ? { name: tool.name, description: tool.description, inputSchema: tool.inputSchema } :
        { status: 'error', error: 'Tool is not registered. Wait for Studio to finish loading.' };
    }
    const groups = ['inspect', 'layout', 'connections', 'site', 'presentation'];
    if (args.group === 'all') return { count: tools.length, groups: groups.map(group => ({
      group, count: tools.filter(tool => groupFor(tool.name) === group).length,
    })) };
    return { tools: tools.filter(tool => groupFor(tool.name) === args.group).map(({ name, description }) => ({ name, description })) };
  }
  const tool = tools.find(item => item.name === name);
  if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`);
  log(name + ' ' + JSON.stringify(args));
  const result = await api.executeTool(tool, args);
  const text = result?.content?.find(block => block.type === 'text')?.text;
  let payload = result;
  if (text || typeof result === 'string') {
    try { payload = JSON.parse(text ?? result); } catch { payload = { text: text ?? result }; }
  }
  // Studio returns rejected edits as {status:"error"} instead of throwing; show them so failures are visible.
  if (payload?.status === 'error' || result?.isError) {
    log(`✗ ${name} bị từ chối: ${String(payload?.error ?? payload?.text ?? 'lỗi không rõ').slice(0, 220)}`);
  }
  if (name === 'propose_floor_rooms') {
    const option = payload?.options?.[0];
    const rooms = option?.affectedRooms.map(room => room.beforeArea ? `${room.name} ${room.beforeArea} → ${room.afterArea} ft²` : `${room.name} ${room.afterArea} ft²`).join(' · ');
    if (option?.stair) log(`Xem trước tầng mới · ${rooms} · cầu thang từ ${option.stair.from} · ${option.errors} lỗi`);
    else if (option) log(`Xem trước thêm phòng · ${rooms} · còn trống ${payload.freeAreaAfter} ft² · ${option.errors} lỗi`);
    else if (payload?.blockers?.length) log(`Không có phương án tầng mới: ${payload.blockers[0]}`);
  }
  if (name === 'inspect_floor_space' && payload?.freeSpots) {
    log(`Diện tích trống ${payload.floor.name}: ${payload.freeArea} / ${payload.footprintBelowArea} ft² · ${Object.entries(payload.freeAreaBySide ?? {}).map(([side, area]) => `${side} ${area}`).join(' · ')}`);
  }
  if (name === 'propose_room_layout') {
    const proposal = payload;
    const preview = proposal?.options?.[0] ?? proposal?.alternatives?.[0];
    if (preview) {
      const areas = preview.affectedRooms
        .map(room => `${room.name}: ${room.beforeArea} → ${room.afterArea} ft²`)
        .join(' · ');
      const label = proposal.options.length ? 'Xem trước' : 'Phương án thay thế';
      log(`${label} · ${areas} · ${preview.errors} lỗi, ${preview.warnings} cảnh báo`);
    }
  }
  return result;
}

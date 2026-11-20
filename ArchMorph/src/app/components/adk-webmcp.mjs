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
  if (name === 'propose_room_layout') {
    const text = result?.content?.find(block => block.type === 'text')?.text;
    let proposal = result;
    if (text || typeof result === 'string') {
      try { proposal = JSON.parse(text ?? result); } catch { /* Use the original tool result. */ }
    }
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

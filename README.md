# Google DevFest 2026: WebMCP + Google ADK demos

This repo contains two live demos. In each one, a Gemini agent built with Google ADK edits a web app through the page's own **WebMCP** tools, using text chat or voice.

| Demo | Folder | What it shows | URL |
|---|---|---|---|
| **RoomLab** | [`demo/`](demo/) | A small room planner with 7 tools. The agent creates, resizes and moves rooms, and places and moves furniture. | http://127.0.0.1:8766/ |
| **ArchMorph** | [`ArchMorph/`](ArchMorph/) | A full architecture studio with 66 tools. The agent previews layout changes and applies them after your approval. | http://127.0.0.1:3001/studio |

The data flow is the same for both demos:

```
Chrome tab (WebMCP tools)  <-- WebSocket -->  Python bridge (Google ADK)  <-->  Gemini / Gemini Live
```

The browser tab runs every tool. Python only relays the agent's tool calls to the tab.

## 1. Requirements

- macOS, with **Python 3.10+**, **Node.js 22+** and **npm**.
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/). Calls may be billed to your account.
- **Chrome with native WebMCP**, which provides `document.modelContext` with `registerTool`, `getTools` and `executeTool`. If your Chrome version requires it, enable `chrome://flags/#enable-webmcp-testing` and restart Chrome. See the [WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).
- A microphone if you want to use voice.

## 2. One-time setup

Put your key in a `.env` file at the repo root. It is git-ignored.

```bash
cd /Users/ngocthach/myGit/Google-DevFest-2026
echo 'GOOGLE_AI_API_KEY=your-key-here' > .env
```

`GOOGLE_API_KEY` also works. If no `.env` file exists, the launcher asks for the key without echoing it and keeps it only for that run.

You can override the models in `.env` if needed. The defaults are in [`demo/config.py`](demo/config.py).

```bash
GOOGLE_MODEL=gemini-4-hydrogen        # text chat
GOOGLE_LIVE_MODEL=gemini-3.8-live     # voice
```

The launcher installs everything else on its first run:
- a Python virtual environment at `./.venv`, from `demo/requirements.txt`;
- `ArchMorph/node_modules`, via `npm ci`.

## 3. Run the demos

```bash
./Start-Demos.command            # both demos
./Start-Demos.command roomlab    # RoomLab only (same as ./Start-RoomLab.command)
./Start-Demos.command archmorph  # ArchMorph only
```

You can also double-click `Start-Demos.command` in Finder.

Wait for **Ready**, then open the URLs above in your WebMCP-enabled Chrome. Keep the terminal open. Press **Ctrl+C** to stop everything the launcher started.

| Port | Service |
|---|---|
| 8766 | RoomLab server, including its ADK bridge |
| 8767 | ArchMorph ADK bridge (`ArchMorph/adk_bridge.py`) |
| 3001 | ArchMorph web app (`vinext dev`) |

If a port is busy, the launcher refuses to start and does not kill anything. Find the old server, stop it, and run the launcher again:

```bash
lsof -iTCP:8767 -sTCP:LISTEN
```

Always open the apps through `http://127.0.0.1:…`, not `file://`. Both bridges only accept connections from these origins.

## 4. Try RoomLab (http://127.0.0.1:8766/)

1. Check that the page shows **Connection & WebMCP tools** and **ADK connected**.
2. In the chat, type: *“Kiểm tra mặt bằng”*. The agent calls `inspect_plan`.
3. Type: *“Tạo phòng làm việc 3 × 3 mét ở góc dưới bên phải”*. A room appears. **Undo** reverses it.
4. Type: *“Di chuyển Kitchen sang góc dưới bên phải của khu đất, giữ nguyên kích thước.”*
   - Expected: the agent calls `move_room`, and Kitchen moves from (0, 6) to (8, 6) m. It stays 4 × 4 m and its furniture moves with it.
   - Then type *“Chuyển Bedroom đến vị trí x 2, y 2.”* Expected: `OVERLAP` with Living room, and the revision doesn't change.
5. Click **🎙 Voice**, allow the microphone, and say: *“Thêm một cái bàn làm việc vào phòng ngủ.”* Then say: *“Chuyển bàn sang bên phải phòng ngủ.”*
6. Check the results:
   - Each tool call appears in the log.
   - Overlapping or out-of-plot rooms and furniture are rejected, including moves.
   - Undo works.

See [`demo/README.md`](demo/README.md) for details (in Vietnamese).

## 5. Try ArchMorph (http://127.0.0.1:3001/studio)

### 5a. Creative Studio demo, text chat

1. Close the “Start with your land” dialog and click **Load Studio demo**. The two-storey Sukoon House loads.
2. Click **Use demo prompt**, then **Send**.
3. The agent should create the room, door and window as one batch. Then it switches to 3D and reports **0 layout issues**.

### 5b. Garden Study: approve a preview from voice

This test checks that a plan previewed in **chat** can be approved later in **voice**. Chat and voice keep separate conversation histories. Only the pending preview is shared between them.

1. Click **Load Studio demo** again to reset the house.
2. In the chat, type:
   *“Giảm Guest Lounge 20% và mở rộng Garden Study. Xem trước phương án, chưa lưu.”*
   - Expected: no complete plan exists, but a partial alternative does: **Garden Study 112 → 142.05 feet vuông**, with nothing saved yet.
3. Click **🎙 Voice** and say: **“Cứ làm đi.”**
   - Expected: the agent does not ask which plan you mean. It calls `apply_pending_preview`, the log shows `apply_changes`, and Garden Study becomes 15 × 9.47 ft (142.05 ft²).
4. Click **Undo** to go back to 112 ft².
5. In the chat, type: *“Chỉ mở rộng Garden Study thêm 10%. Xem trước phương án, chưa lưu.”*
   - Expected: 112 → 123.2 ft².
6. Change the drawing yourself, for example by renaming or moving another room.
7. Say **“Cứ làm đi.”**
   - Expected: *“Bản vẽ đã thay đổi nên chưa lưu…”* The agent previews the plan again against the new drawing, reads out the new numbers and asks again. Nothing is saved.
8. Say **“Cứ làm đi”** once more. This time it applies.

Other useful checks:
- *“Phương án nào đang chờ duyệt?”*. Expected: the agent calls `get_pending_preview`.
- *“Thôi, không làm nữa.”*. Expected: the agent calls `discard_pending_preview`.
- If you pick a secondary option (*“chọn phương án phụ thứ hai”*), the agent applies that option, not the main one.

The pending preview lives in the ArchMorph bridge's memory. It survives switching between chat and voice, stopping and restarting voice, and reloading the tab. It is **lost when the bridge (port 8767) restarts**.

### 5c. Add a new floor with rooms

1. Click **Load Studio demo**.
2. In chat or voice, say: *“Thêm một tầng mới cho tôi, phòng tầng mới tùy bạn đặt tên và thêm số phòng.”*
   - Expected log: `create_floor`, then `propose_floor_rooms`, then a line like *“Xem trước tầng mới · Upper Landing 224 ft² · Master Bedroom 224 ft² · Bedroom 2 160 ft² · cầu thang từ First Floor · 0 lỗi”*.
   - The new Second Floor is empty at this point. The rooms are only a proposal.
3. Say **“Cứ làm đi.”**
   - Expected: one `apply_changes` batch adds the U-shaped stair from First Floor, the Upper Landing, the rooms and a door from the landing to each room.
   - All of it saves as one version and one Undo step. The rooms appear on Second Floor.

4. Say: *“Phòng chơi game, phòng bếp, phòng karaoke, diện tích tùy phần còn lại, fill dần cho đầy tầng.”*
   - Expected: `propose_floor_rooms` with `fill: true`, then a line like *“Xem trước thêm phòng · Game Room 196 ft² · Kitchen 84 ft² · Karaoke Room 224 ft² · Upper Hall 96 ft² · Study 144 ft² · Family Lounge 96 ft² · còn trống 0 ft² · 0 lỗi”*.
   - The planner sizes each room from the free space over the floor below. Each room gets a door to a room that is already connected. When a narrow strip is the only way to reach the remaining space, it becomes an **Upper Hall**. The agent should not ask you for sizes.
5. Say **“Cứ làm đi.”** Expected: one batch, 0 layout errors, and the floor is full (1,448 ft²).
6. Ask: *“Phần bên phải của nhà còn trống bao nhiêu?”* Expected: `inspect_floor_space` and a log line *“Diện tích trống Second Floor: … ft² · top … · right …”*. The agent answers with those numbers.

Why a batch: on an empty upper floor, a single `create_room` is rejected (`DISCONNECTED_CIRCULATION`, because no stair reaches it). A single `add_stairs` is rejected too (`INVALID_STAIR_CONNECTION`, because the stair has no room to land in). Rejected edits now show in the assistant log as **✗ … bị từ chối: …**.

## 6. Automated tests (no Gemini key or Chrome needed)

### ArchMorph

```bash
cd ArchMorph
npm run test:pending        # pending preview: chat→voice approval, stale re-preview, Garden Study, new floor, fill a floor
npm run test:architecture
npm run test:webmcp         # 66 studio tools register and execute
npm run test:demo           # Creative Studio room + door + window, 0 issues
npm run test:model
npm run test:studio
npm run test:pointer
npm run test:walk
npm run test:walls
node --experimental-strip-types scripts/assistant-layout-regression.ts   # Garden Study rebalance
```

`test:pending` runs the real Python logic in [`pending_preview.py`](ArchMorph/pending_preview.py) against the real ArchMorph tools. A Node host, [`scripts/tool-host.ts`](ArchMorph/scripts/tool-host.ts), serves those tools from the Sukoon demo fixture.

### RoomLab

```bash
node demo/test.mjs          # tool list (7 tools), resize, overlap, undo
node demo/create.test.mjs
node demo/move.test.mjs     # move_room: keeps size + furniture, rejects stale/outside/overlap, undo
node demo/session.test.mjs
node demo/ui.test.mjs       # UI bridge with a browser test double: inspect, resize, create, move
```

> **Known stale tests (as of 2026-11-20):**
> - `npm run test:audit` in ArchMorph fails with `NO_EXTERIOR_ACCESS`.
> - `npm run lint` in ArchMorph reports 4 errors, in `src/app/components/AdkChat.tsx` and `scripts/demo-regression.ts`.
>
> These failures existed before the pending-preview change.

## 7. Repo layout

```
Start-Demos.command   launcher: venv + npm ci + API key prompt, then run_demos.py
Start-RoomLab.command RoomLab-only shortcut
run_demos.py          starts and supervises the selected services; refuses busy ports
demo/                 RoomLab: server.py (FastAPI + ADK), core.mjs (tools), voice_live.py, config.py
ArchMorph/            Next.js (vinext) studio + adk_bridge.py + pending_preview.py
```

`demo/config.py`, `demo/voice_live.py` and `demo/gemini_network.py` are shared. The ArchMorph bridge imports them from `../demo`.

## 8. Troubleshooting

- **“Native WebMCP is unavailable in this browser”**: enable WebMCP in Chrome (see Requirements). Chrome windows opened by automation tools usually don't have it.
- **ArchMorph shows “ADK disconnected”**: the bridge on 8767 isn't running, or it was restarted. Reload the tab.
- **Voice disconnects or reports a Gemini Live error**: check that your key can use the live model (`GOOGLE_LIVE_MODEL`). Use text chat as a fallback.
- **`vinext` fails with `ERR_MODULE_NOT_FOUND` under `node_modules/.bin`**: `node_modules` was copied and its symlinks broke. Run `rm -rf ArchMorph/node_modules && (cd ArchMorph && npm ci)`.
- **Run ArchMorph services by hand**, without the launcher. Use two terminals from the repo root, with the key in `.env` or exported:
  ```bash
  (cd ArchMorph && ../.venv/bin/python -m uvicorn adk_bridge:app --host 127.0.0.1 --port 8767 --loop asyncio)
  (cd ArchMorph && npm run dev -- --port 3001 --hostname 127.0.0.1)
  ```

Validation in ArchMorph is conceptual. It is not building-code certification. Don't expose these local servers to a public network.

"""Pending layout preview shared by every chat and voice connection of this bridge.

Chat and voice each run their own ADK session, so conversation history is not shared.
The one piece of context that must survive a switch is the plan the user was shown and
may approve with a bare "cứ làm đi". It is captured deterministically from tool results
(never from model memory) and applied only against the drawing version it was built on.
"""
import asyncio
import copy
import json
import time

PREVIEW_TOOLS = {'propose_room_layout', 'preview_changes'}


def normalize_result(result):
    """WebMCP may return a dict, JSON text, or MCP content blocks; return the parsed payload."""
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except (ValueError, TypeError):
            return result
    if isinstance(result, dict) and isinstance(result.get('content'), list):
        texts = [part.get('text') for part in result['content']
                 if isinstance(part, dict) and isinstance(part.get('text'), str)]
        if texts:
            try:
                return json.loads(texts[0])
            except (ValueError, TypeError):
                return {'status': 'error', 'error': texts[0]} if result.get('isError') else result
    return result


def is_error(result):
    return not isinstance(result, dict) or result.get('status') == 'error' or result.get('isError') is True


class PendingPreviewStore:
    """Holds at most one pending plan per bridge process (local, single-user demo)."""

    def __init__(self):
        self.plan = None
        self.lock = asyncio.Lock()

    def clear(self):
        self.plan = None

    def public(self):
        if not self.plan:
            return {'status': 'none', 'message': 'Không có phương án xem trước nào đang chờ duyệt.'}
        plan = self.plan
        return {'status': 'pending', 'kind': plan['kind'], 'projectId': plan['projectId'],
                'projectName': plan['projectName'], 'expectedVersion': plan['expectedVersion'],
                'rooms': plan['rooms'], 'changes': plan['changes'], 'summaryVi': plan['summaryVi'],
                'previewedAt': plan['previewedAt']}

    async def _project(self, request_browser):
        info = normalize_result(await request_browser('inspect_project', {}))
        project = info.get('project') if isinstance(info, dict) else None
        if not isinstance(project, dict) or not isinstance(project.get('version'), (int, float)):
            return None
        return project

    async def capture(self, request_browser, tool, args, result):
        """Record the plan a preview tool just showed. Returns the stored plan or None."""
        payload = normalize_result(result)
        if tool not in PREVIEW_TOOLS or is_error(payload):
            return None
        project = await self._project(request_browser)
        if not project:
            return None
        if tool == 'propose_room_layout':
            options, alternatives = payload.get('options') or [], payload.get('alternatives') or []
            chosen = options[0] if options else alternatives[0] if alternatives else None
            if not chosen or not chosen.get('changes'):
                return None
            kind = 'complete' if options else 'partial_alternative'
            version, changes, rooms = chosen['expectedVersion'], chosen['changes'], chosen.get('affectedRooms', [])
        else:
            version, changes = payload.get('baseVersion', args.get('expectedVersion')), args.get('changes')
            if not changes:
                return None
            kind, rooms = 'batch', []
        if version != project['version']:
            return None  # The preview is already stale; do not store something unappliable.
        summary = ', '.join(f"{r['name']}: {r['beforeArea']} → {r['afterArea']} feet vuông" for r in rooms) \
            or f"{len(changes)} thay đổi: " + ', '.join(c.get('tool', '?') for c in changes)
        self.plan = {'kind': kind, 'tool': tool, 'args': copy.deepcopy(args), 'projectId': project.get('id'),
                     'projectName': project.get('name'), 'expectedVersion': version,
                     'changes': copy.deepcopy(changes), 'rooms': rooms, 'summaryVi': summary,
                     'previewedAt': time.time()}
        return self.plan

    async def apply(self, request_browser):
        """Apply the pending plan if the drawing is unchanged; otherwise preview it again."""
        async with self.lock:
            plan = self.plan
            if not plan:
                return self.public()
            project = await self._project(request_browser)
            if not project:
                return {'status': 'error', 'error': 'Không đọc được phiên bản bản vẽ hiện tại. Kiểm tra Studio đã tải xong.'}
            if project.get('id') != plan['projectId']:
                self.clear()
                return {'status': 'project_changed', 'message': 'Đã mở dự án khác nên phương án cũ bị huỷ. Hãy yêu cầu xem trước lại.'}
            if project['version'] != plan['expectedVersion']:
                return await self._repreview(request_browser, plan, project['version'])
            result = normalize_result(await request_browser(
                'apply_changes', {'expectedVersion': plan['expectedVersion'], 'changes': plan['changes']}))
            if is_error(result):
                return {'status': 'error', 'error': result.get('error') if isinstance(result, dict) else str(result),
                        'pending': self.public()}
            self.clear()
            return {'status': 'applied', 'appliedPlan': plan['summaryVi'], 'kind': plan['kind'],
                    'previousVersion': plan['expectedVersion'], 'result': result}

    async def _repreview(self, request_browser, plan, current_version):
        old_summary = plan['summaryVi']
        if plan['tool'] == 'propose_room_layout':
            args = plan['args']
        else:
            args = {**plan['args'], 'expectedVersion': current_version}
        result = await request_browser(plan['tool'], args)
        self.clear()
        fresh = await self.capture(request_browser, plan['tool'], args, result)
        if not fresh:
            payload = normalize_result(result)
            return {'status': 'stale_no_plan', 'staleVersion': plan['expectedVersion'], 'currentVersion': current_version,
                    'previousPlan': old_summary,
                    'message': 'Bản vẽ đã thay đổi và không còn phương án hợp lệ. Chưa lưu thay đổi nào.',
                    'blockers': payload.get('blockers', []) if isinstance(payload, dict) else [],
                    'error': payload.get('error') if isinstance(payload, dict) else None}
        return {'status': 'stale_repreviewed', 'staleVersion': plan['expectedVersion'], 'currentVersion': current_version,
                'previousPlan': old_summary, 'newPlan': fresh['summaryVi'], 'kind': fresh['kind'],
                'message': 'Bản vẽ đã thay đổi nên chưa lưu. Đã xem trước lại; hãy đọc số mới và hỏi người dùng duyệt lại.'}


STORE = PendingPreviewStore()

INSTRUCTION = (
    'PENDING PREVIEW: chat and voice have separate conversation histories but share one pending preview. '
    'When the user gives a bare approval such as “cứ làm đi”, “làm đi”, “ok áp dụng”, “đồng ý” or “apply it” and '
    'this conversation has no plan you just presented, call apply_pending_preview immediately; do not ask which plan. '
    'If the user asks what is waiting for approval, call get_pending_preview. '
    'apply_pending_preview applies ONLY the main plan (the first option, or the first alternative when there is no '
    'complete option). When presenting a preview, name that main plan first. If the user picks any other listed option, '
    'call apply_changes with that option\'s exact changes and expectedVersion instead. '
    'If the user declines or cancels the preview, call discard_pending_preview. '
    'If apply_pending_preview returns stale_repreviewed, say the drawing changed so nothing was saved, read the newPlan '
    'numbers and ask for approval again. If it returns none, ask what to change. Report applied only when status is applied. '
)

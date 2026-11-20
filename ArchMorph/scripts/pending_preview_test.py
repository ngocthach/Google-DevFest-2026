"""Garden Study regression for the pending preview shared by chat and voice.

Run from ArchMorph/:  python3 scripts/pending_preview_test.py
Uses the real ArchMorph tools (scripts/tool-host.ts) on the Sukoon Studio demo fixture.
"""
import asyncio, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pending_preview import PendingPreviewStore, normalize_result  # noqa: E402

host = subprocess.Popen(['node', '--experimental-strip-types', '--no-warnings', 'scripts/tool-host.ts'], cwd=ROOT,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

async def browser(name, args):
    host.stdin.write(json.dumps({'name': name, 'args': args}) + '\n'); host.stdin.flush()
    return json.loads(host.stdout.readline())

async def main():
    store = PendingPreviewStore()
    start = await browser('__state__', {})
    guest, garden = start['rooms']['Guest Lounge']['id'], start['rooms']['Garden Study']['id']
    assert start['rooms']['Garden Study']['area'] == 112

    # 1. Chat session: rebalance Guest Lounge -> Garden Study. Only a partial Garden alternative passes.
    args = {'roomId': guest, 'goal': 'rebalance', 'areaPercent': 20, 'neighborRoomId': garden}
    result = await browser('propose_room_layout', args)
    plan = await store.capture(browser, 'propose_room_layout', args, result)
    assert plan and plan['kind'] == 'partial_alternative', plan
    assert plan['expectedVersion'] == start['version']
    assert any(r['name'] == 'Garden Study' and r['afterArea'] == 142.05 for r in plan['rooms']), plan['rooms']
    assert (await browser('__state__', {}))['version'] == start['version'], 'preview must not save'
    print('PASS chat preview stored:', plan['summaryVi'])

    # 2. A fresh voice session has no history; "cứ làm đi" -> apply_pending_preview.
    out = await store.apply(browser)
    after = await browser('__state__', {})
    assert out['status'] == 'applied', out
    assert after['version'] == start['version'] + 1
    assert after['rooms']['Garden Study']['area'] == 142.05 and after['rooms']['Guest Lounge']['area'] == 224
    assert store.public()['status'] == 'none'
    print('PASS voice approval applied once: version', start['version'], '->', after['version'])

    # A second "làm đi" must not re-apply anything.
    again = await store.apply(browser)
    assert again['status'] == 'none' and (await browser('__state__', {}))['version'] == after['version']
    print('PASS repeated approval is a no-op')

    # 3. Stale: preview Garden growth, then the drawing changes before approval.
    await browser('__reset__', {})
    args = {'roomId': garden, 'goal': 'grow', 'areaPercent': 10}
    plan = await store.capture(browser, 'propose_room_layout', args, await browser('propose_room_layout', args))
    assert plan and plan['kind'] == 'complete', plan
    old_version = plan['expectedVersion']
    edit = await browser('update_room', {'roomId': guest, 'name': 'Guest Suite'})  # someone edits the drawing
    changed = (await browser('__state__', {}))['version']
    assert changed != old_version, ('drawing did not change', normalize_result(edit))
    out = await store.apply(browser)
    assert out['status'] == 'stale_repreviewed', out
    assert (await browser('__state__', {}))['version'] == changed, 'stale plan must not be applied'
    assert store.public()['expectedVersion'] == changed
    print('PASS stale preview re-previewed without saving:', out['newPlan'])

    out = await store.apply(browser)
    final = await browser('__state__', {})
    assert out['status'] == 'applied' and final['version'] == changed + 1, out
    assert final['rooms']['Garden Study']['area'] > 112
    print('PASS re-approved plan applied: Garden Study', final['rooms']['Garden Study']['area'], 'sq ft')

    # 4. A direct preview_changes batch is captured too.
    await browser('__reset__', {})
    batch = {'expectedVersion': start['version'], 'changes': [{'tool': 'resize_room', 'input': {'roomId': garden, 'width': 14, 'length': 9}}]}
    plan = await store.capture(browser, 'preview_changes', batch, await browser('preview_changes', batch))
    assert plan and plan['kind'] == 'batch'
    out = await store.apply(browser)
    assert out['status'] == 'applied' and (await browser('__state__', {}))['rooms']['Garden Study']['area'] == 126, out
    print('PASS preview_changes batch captured and applied')

try:
    asyncio.run(main())
finally:
    host.stdin.close(); host.wait(timeout=5)

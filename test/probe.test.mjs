/**
 * MemoService 编排单测：用假 ctx（假 subprocess/fs/sessions/sessionPersistence）验证
 * probe() 的完整流程与降级路径。真实 git 由 memo.test.mjs 的解析单测覆盖，
 * 真实 npm 网络由 probe-smoke.mjs 冒烟覆盖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoService } from '../lib/memo.js'

const GIT_OK_STATUS = '## main...origin/main [ahead 1, behind 2]\n M lib/index.js\n?? new.txt\n'
const GIT_OK_LOG = 'a1b2c3d 2026-02-14\n'
const GIT_OK_REMOTE = 'origin\thttps://github.com/LucienLL/dsh-session-memo.git (fetch)\n'
const PKG = JSON.stringify({ name: 'dsh-session-memo', version: '0.1.0' })

/** 按 argv 返回假输出的假 subprocess。 */
function fakeSubprocess({ gitResults, gitExitCodes }) {
  return {
    async resolveExecutable(cmd) {
      if (cmd !== 'git') throw new Error('unknown executable')
      return 'git'
    },
    spawn(spec) {
      const key = spec.argv.join(' ')
      const entry = (gitResults || {})[key] ?? { exitCode: 0, out: '' }
      const outcome = { exitCode: entry.exitCode ?? 0 }
      return {
        done: Promise.resolve(outcome),
        collected: {
          stdout: { readFrom: () => ({ text: entry.out ?? '' }) },
          stderr: { readFrom: () => ({ text: entry.err ?? '' }) },
        },
      }
    },
  }
}

function makeCtx(overrides = {}) {
  const git = fakeSubprocess(overrides)
  return {
    sessions: overrides.liveSession ? { get: () => ({ header: { cwd: overrides.cwd } }) } : { get: () => undefined },
    sessionPersistence: overrides.cwd ? { inspect: async () => ({ meta: { cwd: overrides.cwd } }) } : { inspect: async () => { throw new Error('no such session') } },
    subprocess: git,
    fs: {
      async resolve(p) { return { key: p } },
      async readText(t) {
        if (overrides.pkgText !== undefined) return overrides.pkgText
        return PKG
      },
    },
    fetchOverride: overrides.fetch || null,
  }
}

// 用假的全局 fetch（Node 24 里 fetch 是全局，probeNpm 直接调 fetch）
function withFetch(fake, fn) {
  const real = globalThis.fetch
  globalThis.fetch = fake
  return fn().finally(() => { globalThis.fetch = real })
}

const FAKE_REGISTRY_OK = async () => ({ ok: true, json: async () => ({ 'dist-tags': { latest: '0.1.3' } }) })

test('probe: 全绿（git ok + pkg ok + npm ok）', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\repo',
    gitResults: {
      'git -C E:\\repo status --porcelain=v1 -b': { out: GIT_OK_STATUS },
      'git -C E:\\repo log -1 --format=%h %cs': { out: GIT_OK_LOG },
      'git -C E:\\repo remote -v': { out: GIT_OK_REMOTE },
    },
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(FAKE_REGISTRY_OK, () => svc.probe('s1'))
  assert.equal(r.git.ok, true)
  assert.equal(r.git.branch, 'main')
  assert.equal(r.git.ahead, 1)
  assert.equal(r.git.behind, 2)
  assert.equal(r.git.dirty, 2)
  assert.equal(r.git.untracked, 1)
  assert.deepEqual(r.git.lastCommit, { hash: 'a1b2c3d', date: '2026-02-14' })
  assert.deepEqual(r.git.remote, { name: 'origin', url: 'https://github.com/LucienLL/dsh-session-memo.git' })
  assert.equal(r.version.ok, true)
  assert.equal(r.version.version, '0.1.0')
  assert.equal(r.npm.ok, true)
  assert.equal(r.npm.latest, '0.1.3')
  assert.equal(r.npm.behind, true)
  assert.equal(r.npm.published, true)
})

test('probe: 非 git 目录（status exit 128）→ not-git，其余仍探测', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\plain',
    gitResults: {
      'git -C E:\\plain status --porcelain=v1 -b': { exitCode: 128, err: 'fatal: not a git repository' },
    },
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(FAKE_REGISTRY_OK, () => svc.probe('s2'))
  assert.deepEqual(r.git, { ok: false, reason: 'not-git', detail: 'exit-128' })
  assert.equal(r.version.ok, true)
  assert.equal(r.npm.ok, true)
})

test('probe: 无 cwd（live 和 cold 都没有）→ no-workspace 全降级', async () => {
  const ctx = makeCtx({})
  const svc = new MemoService(ctx)
  const r = await svc.probe('ghost')
  assert.equal(r.cwd, null)
  assert.deepEqual(r.git, { ok: false, reason: 'no-workspace' })
  assert.equal(r.npm.ok, false)
  assert.equal(r.version.ok, false)
})

test('probe: npm 查询失败（fetch 抛错）→ npm.ok false，git/version 不受影响', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\repo',
    gitResults: {
      'git -C E:\\repo status --porcelain=v1 -b': { out: GIT_OK_STATUS },
      'git -C E:\\repo log -1 --format=%h %cs': { out: GIT_OK_LOG },
      'git -C E:\\repo remote -v': { out: '' },
    },
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(async () => { throw new Error('ECONNREFUSED') }, () => svc.probe('s3'))
  assert.equal(r.git.ok, true)
  assert.equal(r.npm.ok, false)
  assert.equal(r.npm.reason, 'network-error')
  assert.equal(r.version.ok, true)
})

test('probe: npm 404 → not-found', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\repo',
    gitResults: {
      'git -C E:\\repo status --porcelain=v1 -b': { out: GIT_OK_STATUS },
      'git -C E:\\repo log -1 --format=%h %cs': { out: GIT_OK_LOG },
      'git -C E:\\repo remote -v': { out: '' },
    },
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(async () => ({ ok: false, status: 404 }), () => svc.probe('s4'))
  assert.equal(r.npm.ok, false)
  assert.equal(r.npm.reason, 'not-found')
})

test('probe: 无 package.json → version/npm 降级，git 仍探测', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\repo',
    pkgText: undefined,
    gitResults: {},
  })
  // fs.readText 抛错模拟文件不存在
  ctx.fs.readText = async () => { throw new Error('ENOENT') }
  const svc = new MemoService(ctx)
  const r = await svc.probe('s5')
  assert.equal(r.version.ok, false)
  assert.equal(r.version.reason, 'no-package-json')
  assert.equal(r.npm.ok, false)
  assert.equal(r.npm.reason, 'no-package-json')
  assert.equal(r.git.ok, true) // 空 git 输出也被解析为 ok
})

test('probe: 无 git 可执行 → no-git', async () => {
  const ctx = makeCtx({ cwd: 'E:\\repo', gitResults: {} })
  ctx.subprocess.resolveExecutable = async () => { throw new Error('not found') }
  const svc = new MemoService(ctx)
  const r = await svc.probe('s6')
  assert.deepEqual(r.git, { ok: false, reason: 'no-git' })
})

test('resolveCwd: live 优先，其次 cold', async () => {
  const live = makeCtx({ cwd: 'E:\\live', liveSession: true })
  assert.equal(await new MemoService(live).resolveCwd('x'), 'E:\\live')
  const cold = makeCtx({ cwd: 'E:\\cold' })
  assert.equal(await new MemoService(cold).resolveCwd('x'), 'E:\\cold')
  const none = makeCtx({})
  assert.equal(await new MemoService(none).resolveCwd('x'), null)
})


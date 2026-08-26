/**
 * MemoService 编排单测：用假 ctx（假 subprocess/fs/sessions/sessionPersistence）验证
 * probe() 的完整流程与降级路径。真实 git 由 memo.test.mjs 的解析单测覆盖，
 * 真实 npm 网络由 probe-smoke.mjs 冒烟覆盖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoService } from '../lib/memo.js'

const GIT_OK_STATUS = '## main...origin/main [ahead 1, behind 2]\n M lib/index.js\n?? new.txt\n'
const GIT_OK_LOG = 'a1b2c3d 2026-02-14 1700000000\n'
const GIT_OK_REMOTE = 'origin\thttps://github.com/LucienLL/dsh-session-memo.git (fetch)\n'
const PKG = JSON.stringify({ name: 'dsh-session-memo', version: '0.1.0' })

/** 按 argv 返回假输出的假 subprocess。rev-parse 未显式配置时默认返回 cwd（cwd 本身是仓库）。 */
function fakeSubprocess({ gitResults, gitExitCodes }) {
  const sub = {
    spawnCount: 0,
    async resolveExecutable(cmd) {
      if (cmd !== 'git') throw new Error('unknown executable')
      return 'git'
    },
    spawn(spec) {
      sub.spawnCount += 1
      const key = spec.argv.join(' ')
      const explicit = (gitResults || {})[key]
      let entry
      if (explicit !== undefined) {
        entry = explicit
      } else if (key.includes('rev-parse --show-toplevel')) {
        entry = { exitCode: 0, out: spec.argv[2] + '\n' }
      } else {
        entry = { exitCode: 0, out: '' }
      }
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
  return sub
}

function makeCtx(overrides = {}) {
  const git = fakeSubprocess(overrides)
  const reads = []
  return {
    reads,
    sessions: overrides.liveSession ? { get: () => ({ header: { cwd: overrides.cwd } }) } : { get: () => undefined },
    sessionPersistence: overrides.cwd ? { inspect: async () => ({ meta: { cwd: overrides.cwd } }) } : { inspect: async () => { throw new Error('no such session') } },
    subprocess: git,
    fs: {
      async resolve(p) { return { key: p, displayPath: p } },
      async readText(t) {
        reads.push(t.key)
        if (overrides.pkgText !== undefined) return overrides.pkgText
        return PKG
      },
      async listDir() {
        return overrides.dirEntries || []
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

const FAKE_REGISTRY_OK = async () => ({ ok: true, json: async () => ({ version: '0.1.3' }) })

test('probe: 全绿（git ok + pkg ok + npm ok）', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\repo',
    gitResults: {
      'git -C E:\\repo status --porcelain=v1 -b': { out: GIT_OK_STATUS },
      'git -C E:\\repo log -1 --format=%h %cs %ct': { out: GIT_OK_LOG },
      'git -C E:\\repo remote -v': { out: GIT_OK_REMOTE },
    },
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(FAKE_REGISTRY_OK, () => svc.probe('s1'))
  assert.equal(r.git.ok, true)
  assert.equal(r.git.repoPath, 'E:\\repo')
  assert.equal(r.projectRoot, 'E:\\repo')
  assert.equal(r.git.repos.length, 1)
  assert.equal(r.git.repos[0].repoPath, 'E:\\repo')
  assert.equal(r.git.branch, 'main')
  assert.equal(r.git.ahead, 1)
  assert.equal(r.git.behind, 2)
  assert.equal(r.git.dirty, 2)
  assert.equal(r.git.untracked, 1)
  assert.deepEqual(r.git.lastCommit, { hash: 'a1b2c3d', date: '2026-02-14', ts: 1700000000 })
  assert.deepEqual(r.git.remote, { name: 'origin', url: 'https://github.com/LucienLL/dsh-session-memo.git' })
  assert.equal(r.version.ok, true)
  assert.equal(r.version.version, '0.1.0')
  assert.equal(r.npm.ok, true)
  assert.equal(r.npm.latest, '0.1.3')
  assert.equal(r.npm.behind, true)
  assert.equal(r.npm.published, true)
  assert.equal(r.npm.repos.length, 1)
  assert.equal(r.npm.repos[0].repoPath, 'E:\\repo')
  assert.equal(r.npm.repos[0].npm.latest, '0.1.3')
})

test('probe: 非 git 目录（rev-parse exit 128 且无子仓库）→ not-git，其余仍探测', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\plain',
    gitResults: {
      'git -C E:\\plain rev-parse --show-toplevel': { exitCode: 128, err: 'fatal: not a git repository' },
    },
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(FAKE_REGISTRY_OK, () => svc.probe('s2'))
  assert.deepEqual(r.git, { ok: false, reason: 'not-git', detail: 'exit-128' })
  assert.equal(r.version.ok, true)
  assert.equal(r.npm.ok, true)
})

test('probe: cwd 非仓库但子目录有仓库 → 探测子仓库（工作区根场景）', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\ws',
    gitResults: {
      'git -C E:\\ws rev-parse --show-toplevel': { exitCode: 128, err: 'not a repo' },
      'git -C E:\\ws\\proj-a rev-parse --show-toplevel': { out: 'E:/ws/proj-a\n' }, // git 常回正斜杠
      'git -C E:\\ws\\docs rev-parse --show-toplevel': { exitCode: 128 },
      'git -C E:\\ws\\proj-a status --porcelain=v1 -b': { out: '## main...origin/main [behind 1]\n?? x.txt\n' },
      'git -C E:\\ws\\proj-a log -1 --format=%h %cs %ct': { out: GIT_OK_LOG },
      'git -C E:\\ws\\proj-a remote -v': { out: GIT_OK_REMOTE },
    },
    dirEntries: [
      { name: 'proj-a', type: 'directory', target: { displayPath: 'E:\\ws\\proj-a' } },
      { name: 'docs', type: 'directory', target: { displayPath: 'E:\\ws\\docs' } },
      { name: 'readme.md', type: 'file', target: { displayPath: 'E:\\ws\\readme.md' } },
    ],
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(FAKE_REGISTRY_OK, () => svc.probe('s7'))
  assert.equal(r.git.ok, true)
  assert.equal(r.git.repoPath, 'E:\\ws\\proj-a')
  assert.equal(r.projectRoot, 'E:\\ws\\proj-a')
  assert.deepEqual(ctx.reads, ['E:\\ws\\proj-a\\package.json']) // version/npm 跟随仓库根
  assert.equal(r.git.repos.length, 1)
  assert.equal(r.git.repos[0].repoPath, 'E:\\ws\\proj-a')
  assert.equal(r.git.branch, 'main')
  assert.equal(r.git.behind, 1)
  assert.equal(r.git.untracked, 1)
})

test('probe: 多个子仓库 → 取最近有提交的', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\ws2',
    gitResults: {
      'git -C E:\\ws2 rev-parse --show-toplevel': { exitCode: 128 },
      'git -C E:\\ws2\\old rev-parse --show-toplevel': { out: 'E:\\ws2\\old\n' },
      'git -C E:\\ws2\\new rev-parse --show-toplevel': { out: 'E:\\ws2\\new\n' },
      'git -C E:\\ws2\\old log -1 --format=%h %cs %ct': { out: 'o000000 2026-01-01 1700000000\n' },
      'git -C E:\\ws2\\new log -1 --format=%h %cs %ct': { out: 'n000000 2026-08-01 1800000000\n' },
      'git -C E:\\ws2\\new status --porcelain=v1 -b': { out: '## main\n' },
      'git -C E:\\ws2\\new remote -v': { out: '' },
    },
    dirEntries: [
      { name: 'old', type: 'directory', target: { displayPath: 'E:\\ws2\\old' } },
      { name: 'new', type: 'directory', target: { displayPath: 'E:\\ws2\\new' } },
      { name: 'node_modules', type: 'directory', target: { displayPath: 'E:\\ws2\\node_modules' } },
    ],
  })
  const svc = new MemoService(ctx)
  const r = await withFetch(FAKE_REGISTRY_OK, () => svc.probe('s8'))
  assert.equal(r.git.ok, true)
  assert.equal(r.git.repoPath, 'E:\\ws2\\new')
  assert.equal(r.git.repos.length, 2) // 全部子仓库都列出
  assert.equal(r.git.repos[0].repoPath, 'E:\\ws2\\new') // 最近提交在前
  assert.equal(r.git.repos[1].repoPath, 'E:\\ws2\\old')
  assert.equal(r.projectRoot, 'E:\\ws2\\new')
  assert.equal(r.npm.repos.length, 2) // npm 与 git 同粒度：每个仓库都有探测
  assert.equal(r.npm.repos[0].repoPath, 'E:\\ws2\\new')
  assert.equal(r.npm.repos[1].repoPath, 'E:\\ws2\\old')
})

test('probe: 子目录无仓库 → not-git（跳过 node_modules）', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\ws3',
    gitResults: {
      'git -C E:\\ws3 rev-parse --show-toplevel': { exitCode: 128 },
      'git -C E:\\ws3\\node_modules rev-parse --show-toplevel': { out: 'E:\\ws3\\node_modules\n' },
    },
    dirEntries: [
      { name: 'node_modules', type: 'directory', target: { displayPath: 'E:\\ws3\\node_modules' } },
    ],
  })
  const svc = new MemoService(ctx)
  const r = await svc.probe('s9')
  assert.equal(r.git.ok, false)
  assert.equal(r.git.reason, 'not-git')
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

test('probe: 同 cwd 缓存命中（切换会话不重复探测），force 绕过', async () => {
  const ctx = makeCtx({
    cwd: 'E:\\repo',
    gitResults: {
      'git -C E:\\repo status --porcelain=v1 -b': { out: GIT_OK_STATUS },
      'git -C E:\\repo log -1 --format=%h %cs %ct': { out: GIT_OK_LOG },
      'git -C E:\\repo remote -v': { out: GIT_OK_REMOTE },
    },
  })
  const svc = new MemoService(ctx)
  await withFetch(FAKE_REGISTRY_OK, () => svc.probe('a'))
  const afterFirst = ctx.subprocess.spawnCount
  const r2 = await withFetch(FAKE_REGISTRY_OK, () => svc.probe('b')) // 不同会话，同 cwd
  assert.equal(ctx.subprocess.spawnCount, afterFirst) // 缓存命中：零新 git 探测
  assert.equal(r2.git.repoPath, 'E:\\repo')
  assert.equal(r2.npm.ok, true)
  // force=true 绕过缓存重新探测
  await withFetch(FAKE_REGISTRY_OK, () => svc.probe('c', { force: true }))
  assert.ok(ctx.subprocess.spawnCount > afterFirst)
})


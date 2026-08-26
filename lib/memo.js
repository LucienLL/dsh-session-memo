/**
 * dsh-session-memo — 探测逻辑（纯函数 + MemoService 编排）。
 *
 * 纯函数部分（parseGitStatus / parseLastCommit / parseRemote / parsePackageJson /
 * compareVersion）零 DSH import，可单测；MemoService 注入 ctx 后做 host 编排：
 * git 只读探测（status/log/remote）、package.json 读取、npm registry 对比。
 * 权限边界：git 只读命令，npm 只 GET，fs 只 readText —— 绝不写仓库/发布。
 */

import { join as pathJoin } from 'node:path'

// ---------------------------------------------------------------------------
// 纯逻辑（零 DSH import，全部可单测）
// ---------------------------------------------------------------------------

/**
 * 解析 `git status --porcelain=v1 -b` 输出。
 * 首行 `## <branch>...<upstream> [ahead N, behind M]`，其余行每条 = 一个变更路径。
 * 容错：任何字段缺失/格式不符返回 null/0，绝不抛异常。
 * @param {string} output
 * @returns {{ branch: string|null, detached: boolean, upstream: string|null,
 *            ahead: number, behind: number, dirty: number, conflicts: number, untracked: number }}
 */
export function parseGitStatus(output) {
  const lines = String(output == null ? '' : output)
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
  const head = lines[0] || ''
  const branchInfo = parseBranchLine(head)
  let dirty = 0
  let conflicts = 0
  let untracked = 0
  for (let i = 1; i < lines.length; i++) {
    const code = lines[i].slice(0, 2)
    if (code === '??') {
      untracked++
    } else if (code.includes('U') || code === 'AA' || code === 'DD') {
      // 冲突码全集：UU/AA/DD/AU/UA/DU/UD
      conflicts++
    }
    dirty++
  }
  return {
    branch: branchInfo.branch,
    detached: branchInfo.detached,
    upstream: branchInfo.upstream,
    ahead: branchInfo.ahead,
    behind: branchInfo.behind,
    dirty,
    conflicts,
    untracked,
  }
}

/**
 * 解析 porcelain -b 首行（`## main...origin/main [ahead 0, behind 2]`）。
 * 分支名可能含 `.`，故按 `...` 切分而非正则限定字符集。
 * @param {string} head 首行原文（不含行尾）
 */
export function parseBranchLine(head) {
  const result = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0 }
  if (typeof head !== 'string') return result
  const rest = head.replace(/^##\s+/, '')
  if (rest === '' || rest === head) return result // 不以 ## 开头 → 无法解析
  if (rest === 'HEAD (no branch)' || rest === 'HEAD') {
    return { branch: null, detached: true, upstream: null, ahead: 0, behind: 0 }
  }
  const sep = rest.indexOf('...')
  let branch = rest
  let upstream = null
  let meta = ''
  if (sep !== -1) {
    branch = rest.slice(0, sep)
    const right = rest.slice(sep + 3)
    const bracket = right.indexOf(' [')
    if (bracket !== -1) {
      upstream = right.slice(0, bracket)
      meta = right.slice(bracket + 2)
    } else {
      upstream = right
    }
  }
  const aheadMatch = meta.match(/ahead\s+(\d+)/)
  const behindMatch = meta.match(/behind\s+(\d+)/)
  return {
    branch: branch || null,
    detached: false,
    upstream: upstream || null,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  }
}

/**
 * 解析 `git log -1 --format=%h %cs %ct` 输出（`a1b2c3d 2026-02-14 1787681438`）。
 * 兼容旧的两列格式（无时间戳时 ts=0）。
 * @param {string} output
 * @returns {{ hash: string, date: string|null, ts: number }|null}
 */
export function parseLastCommit(output) {
  const line = String(output == null ? '' : output).split(/\r?\n/)[0] || ''
  const m = line.match(/^(\S+)(?:\s+(\S+))?(?:\s+(\d+))?/)
  if (!m) return null
  return { hash: m[1], date: m[2] || null, ts: m[3] ? Number(m[3]) : 0 }
}

/**
 * 解析 `git remote -v` 输出，取第一行远程（`origin\thttps://github.com/a/b.git (fetch)`）。
 * @param {string} output
 * @returns {{ name: string, url: string }|null}
 */
export function parseRemote(output) {
  const line = String(output == null ? '' : output)
    .split(/\r?\n/)
    .find((l) => l.trim() !== '')
  if (!line) return null
  const m = line.match(/^(\S+)\s+(\S+)/)
  return m ? { name: m[1], url: m[2] } : null
}

/**
 * 解析 package.json 文本，提取 name/version。
 * @param {string} text
 * @returns {{ ok: boolean, reason?: string, name: string|null, version: string|null }}
 */
export function parsePackageJson(text) {
  try {
    const data = JSON.parse(String(text == null ? '' : text))
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'invalid', name: null, version: null }
    }
    return {
      ok: true,
      name: typeof data.name === 'string' ? data.name : null,
      version: typeof data.version === 'string' ? data.version : null,
    }
  } catch {
    return { ok: false, reason: 'parse-error', name: null, version: null }
  }
}

/**
 * 宽松 semver 比较：数字段主/次/补丁逐段比，pre-release 后缀视为低于正式版。
 * 非数字段按 0 处理。相等返回 0，a<b 返回负，a>b 返回正。
 * @param {string} a
 * @param {string} b
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  // 只区分「有 pre-release」vs「无」；具体 pre 后缀宽松视为相等
  if (Boolean(pa[3]) !== Boolean(pb[3])) {
    return pa[3] ? -1 : 1 // 有 pre-release 的版本低于同数字正式版
  }
  return 0
}

function parseSemver(v) {
  const s = String(v == null ? '' : v).trim()
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return [0, 0, 0, null]
  return [
    Number(m[1] || 0),
    Number(m[2] || 0),
    Number(m[3] || 0),
    m[4] ? m[4] : null,
  ]
}

/**
 * 本地版本 vs registry latest 的发布状态推断。
 * 仅凭 dist-tags.latest 无法精确判断「本地版本是否在 registry」，取近似：
 *  - behind:  local < latest（落后，该去发布）
 *  - published: local <= latest（registry 已有不旧于本地的版本；若 local 超前则视为未发布）
 * @param {string|null|undefined} local
 * @param {string|null|undefined} latest
 * @returns {{ behind: boolean, published: boolean }}
 */
export function compareVersion(local, latest) {
  if (!local || !latest) return { behind: false, published: false }
  const c = compareSemver(local, latest)
  return { behind: c < 0, published: c <= 0 }
}

// ---------------------------------------------------------------------------
// MemoService — host 编排（注入 ctx）
// ---------------------------------------------------------------------------

const GIT_GRACE_MS = 5000
const NPM_FETCH_TIMEOUT_MS = 5000
const COLLECT = { maxBytes: 64 * 1024 }
/** git 探测结果按 cwd 缓存（git 快，60s 重查一次足够）。 */
const GIT_CACHE_TTL_MS = 60000
/** npm 发布状态按 cwd 缓存（registry 经代理时快时慢；发布状态变化频率低，5 分钟缓存 + 手动刷新 force）。 */
const NPM_CACHE_TTL_MS = 300000

/** 子目录仓库扫描时跳过的目录名（避免扫 node_modules / 元数据目录）。 */
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.pnpm', '.git', '.dsh', '.agents', '.claude', '.idea',
  '.vscode', 'dist', 'build', 'out', '.npm-cache', 'bin', 'obj',
])

/** git 输出路径统一为本地分隔符（Windows 上 git 常回正斜杠）。 */
function toNativePath(p) {
  if (typeof p !== 'string') return p
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p
}
function normPath(p) {
  return toNativePath(p).toLowerCase()
}

/**
 * @param {object} ctx Cordis host context（需含 subprocess / fs / sessions / sessionPersistence）
 */
export class MemoService {
  constructor(ctx) {
    this.ctx = ctx
    this.gitCache = new Map() // cwd -> { ts, git }
    this.npmCache = new Map() // cwd -> { ts, npmByRepo }
  }

  /**
   * 解析会话工作区路径：live 会话读 header.cwd，cold 会话 inspect 读 meta.cwd。
   * @param {string} sessionId
   * @returns {Promise<string|null>}
   */
  async resolveCwd(sessionId) {
    try {
      const live = this.ctx.sessions?.get(sessionId)
      if (live && typeof live.header?.cwd === 'string' && live.header.cwd !== '') {
        return live.header.cwd
      }
    } catch {
      /* fall through to persistence */
    }
    try {
      const insp = await this.ctx.sessionPersistence?.inspect(sessionId)
      if (insp && typeof insp.meta?.cwd === 'string' && insp.meta.cwd !== '') {
        return insp.meta.cwd
      }
    } catch {
      /* no persisted session */
    }
    return null
  }

  /**
   * 执行一条只读 git 命令；任何失败都不抛，返回结构化结果。
   * @param {string} cwd
   * @param {string[]} args git 参数（不含 -C）
   */
  async runGit(cwd, args) {
    let git
    try {
      git = await this.ctx.subprocess.resolveExecutable('git')
    } catch {
      return { spawnFailed: true, reason: 'no-git' }
    }
    let handle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [git, '-C', cwd, ...args],
        cwd,
        stdio: { stdin: 'ignore', stdout: COLLECT, stderr: COLLECT },
        graceMs: GIT_GRACE_MS,
      })
    } catch (e) {
      return { spawnFailed: true, reason: 'spawn-error', detail: String(e?.message || e) }
    }
    let outcome
    try {
      outcome = await handle.done
    } catch (e) {
      return { spawnFailed: true, reason: 'spawn-error', detail: String(e?.message || e) }
    }
    const out = handle.collected?.stdout?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0) {
      return {
        spawnFailed: true,
        reason: `exit-${outcome.exitCode}`,
        stderr: (handle.collected?.stderr?.readFrom(0).text ?? '').trim(),
      }
    }
    return { ok: true, out }
  }

  /**
   * git 探测：branch/ahead/behind/dirty/conflicts/lastCommit/remote。
   *
   * 仓库定位顺序（解决「会话 cwd 是工作区根、仓库在子目录」的场景）：
   *  1. cwd 本身或其祖先仓库（git rev-parse --show-toplevel 一步搞定）；
   *  2. cwd 直接子目录中的仓库（全部探测，按最近提交时间降序）；
   *  3. 都没有 → not-git。
   * 多仓库与仓库内子命令均并行执行（status/log/remote 互不依赖）。
   */
  async probeGit(cwd) {
    const top = await this.runGit(cwd, ['rev-parse', '--show-toplevel'])
    if (top.ok) {
      return this.wrapRepos(await this.probeRepo(toNativePath(top.out.trim())))
    }
    if (top.reason === 'no-git') {
      return { ok: false, reason: 'no-git' }
    }
    const candidates = await this.findChildRepos(cwd)
    if (candidates.length === 0) {
      return { ok: false, reason: 'not-git', detail: top.reason }
    }
    const results = (await Promise.all(candidates.map((c) => this.probeRepo(c)))).filter((r) => r.ok)
    if (results.length === 0) {
      return { ok: false, reason: 'not-git', detail: top.reason }
    }
    results.sort((a, b) => (b.ts || 0) - (a.ts || 0))
    return this.wrapRepos(results)
  }

  /** 展开兼容字段（= 最近提交的仓库）并附全量仓库列表。 */
  wrapRepos(repos) {
    if (!Array.isArray(repos)) repos = [repos]
    return { ok: true, repos, ...repos[0] }
  }

  /** 在一个确定是仓库根的目录上跑完整 git 探测（status/log/remote 并行）。 */
  async probeRepo(root) {
    const [status, log, remotes] = await Promise.all([
      this.runGit(root, ['status', '--porcelain=v1', '-b']),
      this.runGit(root, ['log', '-1', '--format=%h %cs %ct']),
      this.runGit(root, ['remote', '-v']),
    ])
    if (!status.ok) {
      // 128 = 非 git 仓库或 git 失败；no-git = 无 git 可执行文件
      return status.reason === 'no-git'
        ? { ok: false, reason: 'no-git' }
        : { ok: false, reason: 'not-git', detail: status.reason }
    }
    const parsed = parseGitStatus(status.out)
    const lastCommit = log.ok ? parseLastCommit(log.out) : null
    const remote = remotes.ok ? parseRemote(remotes.out) : null
    return {
      ok: true,
      repoPath: root,
      branch: parsed.branch,
      detached: parsed.detached,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      dirty: parsed.dirty,
      conflicts: parsed.conflicts,
      untracked: parsed.untracked,
      lastCommit,
      remote,
      ts: lastCommit && lastCommit.ts ? lastCommit.ts : 0,
    }
  }

  /**
   * 扫描 cwd 直接子目录中的 git 仓库（只确认仓库根，ts 由 probeRepo 的 log 提供）。
   * @param {string} cwd
   * @returns {Promise<string[]>}
   */
  async findChildRepos(cwd) {
    let entries
    try {
      const dir = await this.ctx.fs.resolve(cwd)
      entries = await this.ctx.fs.listDir(dir)
    } catch {
      return []
    }
    const children = []
    for (const entry of entries) {
      if (entry.type !== 'directory' || SKIP_DIR_NAMES.has(entry.name)) continue
      const childPath = typeof entry.target?.displayPath === 'string' && entry.target.displayPath !== ''
        ? entry.target.displayPath
        : pathJoin(cwd, entry.name)
      children.push(childPath)
    }
    const results = await Promise.all(children.map(async (childPath) => {
      const top = await this.runGit(childPath, ['rev-parse', '--show-toplevel'])
      if (top.ok && normPath(top.out.trim()) === normPath(childPath)) return childPath
      return null
    }))
    return results.filter(Boolean)
  }

  /** package.json 探测：name/version。 */
  async probeVersion(cwd) {
    try {
      const target = await this.ctx.fs.resolve(pathJoin(cwd, 'package.json'))
      const text = await this.ctx.fs.readText(target)
      return parsePackageJson(text)
    } catch {
      return { ok: false, reason: 'no-package-json', name: null, version: null }
    }
  }

  /**
   * npm 探测：registry dist-tags.latest vs 本地版本。
   * @param {string|null|undefined} name
   * @param {string|null|undefined} localVersion
   */
  async probeNpm(name, localVersion) {
    if (!name || !localVersion) {
      return { ok: false, reason: 'no-package-json', name: name || null, local: localVersion || null }
    }
    let controller
    let timer
    try {
      controller = new AbortController()
      timer = setTimeout(() => controller.abort(), NPM_FETCH_TIMEOUT_MS)
      // 用 /latest 轻量端点（只返回最新版小 JSON），比全量 metadata 快得多。
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!res.ok) {
        return { ok: false, reason: res.status === 404 ? 'not-found' : `http-${res.status}`, name, local: localVersion }
      }
      const body = await res.json()
      const latest = body && typeof body.version === 'string' ? body.version : null
      if (!latest) {
        return { ok: false, reason: 'no-dist-tags', name, local: localVersion }
      }
      const verdict = compareVersion(localVersion, latest)
      return {
        ok: true,
        name,
        local: localVersion,
        latest,
        behind: verdict.behind,
        published: verdict.published,
      }
    } catch (e) {
      const reason = controller?.signal?.aborted ? 'timeout' : 'network-error'
      return { ok: false, reason, detail: String(e?.message || e), name, local: localVersion }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 一次完整探测（自动结果，不落盘；手动覆盖/标签由 client 从 settings 读并合并）。
   * 单点失败不拖垮整体：各字段独立降级。
   *
   * 性能：git 多仓库与 npm 多包探测均并行；缓存按 cwd 分两段——
   * git 60s（重查只要 ~0.3s）、npm 5min（registry 网络慢，发布状态变化频率低）；
   * 手动刷新 force=true 两段都绕过。
   * @param {string} sessionId
   * @param {{force?: boolean}} [opts]
   */
  async probe(sessionId, opts = {}) {
    const cwd = await this.resolveCwd(sessionId)
    if (!cwd) {
      return {
        cwd: null,
        git: { ok: false, reason: 'no-workspace' },
        npm: { ok: false, reason: 'no-workspace', name: null, local: null, repos: [] },
        version: { ok: false, reason: 'no-workspace', name: null, version: null },
      }
    }
    const now = Date.now()
    const force = opts.force === true
    const gitC = this.gitCache.get(cwd)
    const gitFresh = force || !gitC || now - gitC.ts >= GIT_CACHE_TTL_MS
    const git = gitFresh ? await this.probeGit(cwd) : gitC.git
    if (gitFresh) this.gitCache.set(cwd, { ts: now, git })
    // 对每个解析出的仓库探测 version+npm（与 git 卡片同粒度）；无仓库时退回工作区根。
    // npm.repos 与 git.repos 一一对应，兼容字段（npm/version）= 最近提交仓库的结果。
    const repos = git && git.ok && Array.isArray(git.repos) && git.repos.length > 0 ? git.repos : []
    const targets = repos.length > 0 ? repos.map((r) => r.repoPath) : [cwd]
    const npmC = this.npmCache.get(cwd)
    const npmFresh = force || !npmC || now - npmC.ts >= NPM_CACHE_TTL_MS
    const npmRepos = await Promise.all(targets.map(async (repoPath) => {
      // package.json 每次都现读（fs 读，微秒级）；npm fetch 命中 5 分钟缓存
      const pkg = await this.probeVersion(repoPath)
      let npm
      if (!npmFresh && npmC && npmC.npmByRepo[repoPath]) {
        npm = npmC.npmByRepo[repoPath]
      } else {
        npm = await this.probeNpm(pkg.ok ? pkg.name : null, pkg.ok ? pkg.version : null)
      }
      return { repoPath, version: pkg, npm }
    }))
    if (npmFresh) {
      const byRepo = {}
      for (const e of npmRepos) byRepo[e.repoPath] = e.npm
      this.npmCache.set(cwd, { ts: now, npmByRepo: byRepo })
    }
    const primary = npmRepos[0]
    return {
      cwd,
      projectRoot: repos.length > 0 && repos[0] && typeof repos[0].repoPath === 'string' ? repos[0].repoPath : cwd,
      git,
      version: primary.version.ok ? { ok: true, version: primary.version.version, name: primary.version.name } : primary.version,
      npm: { ...primary.npm, repos: npmRepos },
    }
  }
}

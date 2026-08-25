/**
 * 一次性冒烟（真实网络）：用桩 ctx（假 git subprocess + 真实 fs）跑 MemoService.probe()，
 * 验证 npm registry 真实查询与 package.json 真实读取的输出形状。
 * 沙箱内子进程 spawn 受限，git 路径由 probe.test.mjs 用假 subprocess 覆盖。
 * 非发布产物，仅本地验证用。
 */
import { readFileSync } from 'node:fs'
import { MemoService } from '../lib/memo.js'

const REPO = process.argv[2] || 'E:\\Deepseek\\PluginCreating\\dsh-session-id'

const ctx = {
  sessions: { get: () => undefined },
  sessionPersistence: { inspect: async () => ({ meta: { cwd: REPO } }) },
  subprocess: {
    async resolveExecutable() { return 'git' },
    spawn() {
      return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } } }
    },
  },
  fs: {
    async resolve(p) { return { key: p } },
    async readText(t) { return readFileSync(t.key, 'utf8') },
  },
}

const result = await new MemoService(ctx).probe('smoke-session')
console.log(JSON.stringify(result, null, 2))

const npm = result.npm || {}
if (!npm.ok || typeof npm.latest !== 'string') throw new Error('npm 冒烟失败: ' + JSON.stringify(npm))
console.log('npm smoke OK:', npm.name, 'local', npm.local, 'latest', npm.latest, 'behind', npm.behind)
const v = result.version || {}
if (!v.ok) throw new Error('version 冒烟失败')
console.log('version smoke OK:', v.version)

/**
 * dsh-session-memo — host 侧：settings namespace 注册 + /probe webServer 路由。
 *
 * 数据流：
 *  - 自动探测（git/npm/version）由 MemoService 实时计算，经 GET /dsh-session-memo/probe 返回，不落盘；
 *  - 手动数据（版本覆盖 / 备注 / 标记已发布 / 备忘标签）写 settings namespace `dsh-session-memo`，
 *    client 经 settingsScope 读写；
 *  - 状态联动为弱依赖：面板读 `dsh-session-status` namespace 快照，未安装则隐藏状态区。
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { MemoService } from './memo.js'

export const name = 'dsh-session-memo'
export const inject = ['settings', 'webServer', 'subprocess', 'fs', 'sessions', 'sessionPersistence']

const NS = settingsNamespace('dsh-session-memo')

/** 每会话手动覆盖：version（覆盖自动探测）、note（自由备注）、publishedAt（标记已发布时间戳，0=未标记）。 */
const OverrideSchema = z.object({
  version: z.string().default(''),
  note: z.string().default(''),
  publishedAt: z.number().default(0),
})

/** namespace 形状：{ overrides: { <sessionId>: Override }, tags: { <sessionId>: string[] } } */
const MEMO_SCHEMA = z.object({
  overrides: z.dict(OverrideSchema).default({}),
  tags: z.dict(z.array(z.string())).default({}),
})

const DEFAULT_BASE = { overrides: {}, tags: {} }

export function apply(ctx) {
  // 注册即挂在插件 fiber 上，fiber 销毁自动注销。
  ctx.settings.register(NS, MEMO_SCHEMA, { base: DEFAULT_BASE })

  const memo = new MemoService(ctx)

  ctx.effect(() => {
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://dsh')
        const sessionId = url.searchParams.get('sessionId') || ''
        if (!sessionId) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'missing sessionId' }))
          return
        }
        const result = await memo.probe(sessionId, { force: url.searchParams.get('force') === '1' })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, sessionId, ...result }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }))
      }
    }
    return ctx.webServer.register({ kind: 'exact', path: '/dsh-session-memo/probe', handler })
  }, 'dsh-session-memo: probe route')
}

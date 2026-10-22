/**
 * client apply() 契约测试：用假 ctx 执行 bundle 的 apply，验证
 *  - configForms.get 绑定 dsh-session-memo / dsh-session-status 两个 namespace
 *  - slots.inject 注入 conversation.session.header.actions 与 shell.overlay
 *  - 每个注入回调返回合法的槽注册（id = dsh-session-memo + 组件函数）
 * 锁住槽位契约，避免拼错槽名导致面板不出现。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let captured = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load({ factory }) {
        captured = factory((name) => ({ name }))
      },
    },
  },
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox)
if (captured === null) throw new Error('bundle factory did not run')

const binds = []
const injections = []
const effects = []

const fakeScope = {
  getSnapshot: () => ({ status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }),
  subscribe: () => () => {},
  set: async () => {},
  unset: async () => {},
}

const fakeCtx = {
  configForms: {
    get(namespace) {
      binds.push(namespace)
      return fakeScope
    },
  },
  slots: {
    inject(slotName, cb) {
      injections.push({ slotName, cb })
      return () => {}
    },
    register(def, component) {
      return { def, component }
    },
  },
  effect(cb, label) {
    effects.push({ label, cb })
    return () => {}
  },
}

captured.apply(fakeCtx)

// 1. configForms 绑定
const namespaces = binds
if (namespaces.join(',') !== 'dsh-session-memo,dsh-session-status') {
  throw new Error('unexpected bound namespaces: ' + JSON.stringify(namespaces))
}

// 2. 运行 effect 回调，触发 slots.inject（apply 里 inject 被包在 ctx.effect 内）
for (const eff of effects) eff.cb()

const slotNames = injections.map((i) => i.slotName)
if (slotNames.join(',') !== 'conversation.session.header.actions,shell.overlay') {
  throw new Error('unexpected slot injections: ' + JSON.stringify(slotNames))
}

// 3. 注册形状：回调应返回 { def: {id: dsh-session-memo, name: <槽>}, component: function }
for (const inj of injections) {
  const reg = inj.cb()
  if (!reg || !reg.def || reg.def.id !== 'dsh-session-memo') {
    throw new Error(`slot ${inj.slotName} registration missing id dsh-session-memo: ${JSON.stringify(reg)}`)
  }
  if (typeof reg.component !== 'function') {
    throw new Error(`slot ${inj.slotName} registration component is not a function`)
  }
}

// 4. effect 生命周期挂接
if (effects.length !== 2) throw new Error('expected 2 effects, got ' + effects.length)

console.log('client-apply OK: namespaces =', JSON.stringify(namespaces))
console.log('client-apply OK: slots =', JSON.stringify(slotNames))
console.log('client-apply OK: registrations =', injections.map((i) => i.def?.id ?? 'unknown').join(','))

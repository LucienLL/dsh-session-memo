/**
 * dsh-session-memo — 浏览器 bundle（手写 lazy-CJS，无构建步骤）。
 *
 * 双轨制提醒：本文件 `exports.inject` 写 Cordis 服务名（slots / settingsScope），
 * 不是 NPM 包名（写错会导致 web boot 永久 pending）。
 *
 * 组成：
 *  1. `conversation.session.header.actions` 入口按钮（scope: session，框架注入 sessionId prop）
 *  2. `shell.overlay` 浮动面板（scope: root，用 props.useSessions 取当前会话）
 *  3. 数据流：GET /dsh-session-memo/probe?sessionId= 取自动探测；settingsScope 读写
 *     手动覆盖（版本/备注/标记已发布）与备忘标签；弱依赖读 dsh-session-status 状态区。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-memo',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')

    // 只声明本 bundle 实际使用的 Cordis 服务（服务名，非包名）。
    var inject = ['slots', 'settingsScope']

    // ---------- 模块级共享开合状态（按钮在 session 作用域，面板在 root 作用域） ----------
    var openListeners = []
    var openValue = false
    function getOpen() { return openValue }
    function setOpen(next) {
      if (openValue === next) return
      openValue = next
      for (var i = 0; i < openListeners.length; i++) openListeners[i]()
    }
    function subscribeOpen(fn) {
      openListeners.push(fn)
      return function () {
        var i = openListeners.indexOf(fn)
        if (i >= 0) openListeners.splice(i, 1)
      }
    }

    // ---------- 样式（DSW CSS 变量 + 兜底值） ----------
    var S = {
      btn: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '28px', height: '28px', margin: '0 2px', padding: '0',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
        borderRadius: '8px', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #c9d2e0)',
        cursor: 'pointer', fontSize: '14px', lineHeight: '1', flex: 'none',
      },
      panel: {
        position: 'fixed', top: '64px', right: '12px', width: '320px',
        maxHeight: 'calc(100vh - 96px)', display: 'flex', flexDirection: 'column',
        background: 'var(--dsw-specific-tip, #1e2533)',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
        borderRadius: '12px', boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
        zIndex: 1000, overflow: 'hidden', fontFamily: 'inherit',
        pointerEvents: 'auto', // shell.overlay 层默认 click-through，面板自身要接管指针事件
        color: 'var(--dsw-alias-label-primary, #e6ebf2)', fontSize: '12px',
      },
      header: {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        flex: 'none',
      },
      headerTitle: { fontWeight: 600, fontSize: '13px', marginRight: 'auto' },
      body: { overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' },
      card: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
        borderRadius: '10px', padding: '8px 10px',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06))',
      },
      cardTitle: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9aa4b2)', marginBottom: '6px', fontWeight: 600 },
      row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', lineHeight: '1.7' },
      rowLabel: { color: 'var(--dsw-alias-label-secondary, #9aa4b2)', flex: 'none' },
      rowValue: { textAlign: 'right', wordBreak: 'break-all', minWidth: '0' },
      dot: { width: '8px', height: '8px', borderRadius: '50%', flex: 'none', display: 'inline-block', marginRight: '6px' },
      input: {
        boxSizing: 'border-box', width: '100%', padding: '5px 8px', marginTop: '4px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3))',
        borderRadius: '6px', background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))',
        color: 'var(--dsw-alias-label-primary, #e6ebf2)', fontSize: '12px', outline: 'none',
      },
      textarea: {
        boxSizing: 'border-box', width: '100%', minHeight: '56px', resize: 'vertical',
        padding: '6px 8px', marginTop: '4px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3))',
        borderRadius: '6px', background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))',
        color: 'var(--dsw-alias-label-primary, #e6ebf2)', fontSize: '12px', outline: 'none',
        fontFamily: 'inherit',
      },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '2px 8px', borderRadius: '999px', fontSize: '11px',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.14))',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
        color: 'var(--dsw-alias-label-primary, #e6ebf2)',
      },
      chipX: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary, #9aa4b2)', border: 'none', background: 'none', padding: '0', fontSize: '12px', lineHeight: '1' },
      miniBtn: {
        padding: '4px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary, #c9d2e0)',
        flex: 'none',
      },
      primaryBtn: {
        padding: '4px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
        border: '1px solid transparent', background: 'var(--dsw-alias-accent-strong, #4cc9f0)',
        color: '#0b1220', fontWeight: 600, flex: 'none',
      },
      statusBox: { padding: '6px 8px', borderRadius: '8px', fontSize: '11px', lineHeight: '1.5' },
      reason: { color: 'var(--dsw-alias-label-secondary, #9aa4b2)', fontSize: '11px' },
    }
    var COLOR_SYNC = '#22c55e'
    var COLOR_WARN = '#f59e0b'
    var COLOR_BAD = '#ef4444'

    // ---------- 状态联动（弱依赖 dsh-session-status） ----------
    // 内置三态与插件一 BUILTIN_LABELS 保持一致。settings 的数组字段是「整体替换」
    // 语义：用户一旦写了自定义 labels，resolved value 里内置三态会被顶掉，所以这里
    // 必须自行「内置前置 + user 标签去重追加」（同插件一 resolveLabels）。
    var BUILTIN_LABELS = [
      { key: 'active', name: '进行中', color: '#22c55e', builtin: true },
      { key: 'done', name: '已结项', color: '#3b82f6', builtin: true },
      { key: 'paused', name: '搁置中', color: '#9ca3af', builtin: true },
    ]
    var BUILTIN_KEYS = { active: true, done: true, paused: true }
    function resolveStatusLabels(value) {
      var raw = value && Array.isArray(value.labels) ? value.labels : []
      var seen = {}
      var merged = []
      for (var i = 0; i < BUILTIN_LABELS.length; i++) {
        merged.push(BUILTIN_LABELS[i])
        seen[BUILTIN_LABELS[i].key] = true
      }
      for (var j = 0; j < raw.length; j++) {
        var label = raw[j]
        if (!label || typeof label !== 'object' || typeof label.key !== 'string' || seen[label.key]) continue
        seen[label.key] = true
        merged.push(label)
      }
      return merged
    }

    // ---------- 工具函数 ----------
    function probe(sessionId) {
      return fetch('/dsh-session-memo/probe?sessionId=' + encodeURIComponent(sessionId)).then(function (res) {
        return res.json()
      })
    }
    function shortId(id) {
      return typeof id === 'string' && id.length > 10 ? id.slice(0, 8) + '…' : id
    }
    function shortPath(p) {
      if (typeof p !== 'string' || p === '') return ''
      return p.length > 46 ? '…' + p.slice(-44) : p
    }
    function fmtTs(ts) {
      try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }) } catch (e) { return String(ts) }
    }
    function gitSyncLabel(g) {
      if (!g || !g.ok) return null
      var parts = []
      if (g.ahead > 0) parts.push('领先 ' + g.ahead)
      if (g.behind > 0) parts.push('落后 ' + g.behind)
      if (parts.length === 0) parts.push('已同步')
      if (g.dirty > 0) parts.push(g.dirty + ' 个未提交')
      if (g.conflicts > 0) parts.push('冲突 ' + g.conflicts)
      return parts.join(' · ')
    }
    function gitSyncColor(g) {
      if (!g || !g.ok) return COLOR_WARN
      if (g.conflicts > 0) return COLOR_BAD
      if (g.behind > 0 || g.dirty > 0) return COLOR_WARN
      return COLOR_SYNC
    }
    function reasonText(r) {
      var map = {
        'no-workspace': '无工作区（会话无 cwd）',
        'not-git': '非 git 项目',
        'no-git': '未检测到 git',
        'no-package-json': '无 package.json',
        'not-found': 'registry 无此包（尚未发布）',
        'network-error': '无法连接 registry',
        timeout: '查询 registry 超时',
        'no-dist-tags': 'registry 无 dist-tags.latest',
      }
      return map[r] || (r ? String(r) : '未知')
    }

    // ---------- 入口按钮 ----------
    function MemoButton(props) {
      var open = react.useSyncExternalStore(subscribeOpen, getOpen)
      var sessionId = props && props.sessionId
      if (typeof sessionId !== 'string' || sessionId === '') return null
      return react.createElement('button', {
        type: 'button',
        title: open ? '关闭对话备忘录' : '对话备忘录（GitHub / npm / 版本 / 标签）',
        'aria-label': '对话备忘录',
        onClick: function (e) { e.stopPropagation(); setOpen(!openValue) },
        style: Object.assign({}, S.btn, open ? { color: 'var(--dsw-alias-label-primary-bluish, #4cc9f0)' } : {}),
      }, '📋')
    }

    // ---------- 状态 pill（弱依赖 dsh-session-status；未安装时整区隐藏） ----------
    function StatusPill(props) {
      var snap = props.statusSnap
      var ready = snap && snap.status === 'ready' && snap.value &&
        typeof snap.value.sessions === 'object' && snap.value.sessions !== null
      if (!ready) return null
      var labels = resolveStatusLabels(snap.value)
      var map = snap.value.sessions
      var key = map[props.sessionId]
      var label = null
      for (var i = 0; i < labels.length; i++) {
        if (labels[i] && labels[i].key === key) { label = labels[i]; break }
      }
      function cycle(e) {
        e.stopPropagation()
        // 与插件一 nextSessionStatus 同语义：无状态/自定义 → active → done → paused → 无状态。
        // 自定义标签不参与快速循环（通过插件一的选择器设置）。
        var ORDER = ['active', 'done', 'paused']
        var next = null
        var idx = ORDER.indexOf(key)
        if (idx === -1) next = 'active'
        else if (idx + 1 < ORDER.length) next = ORDER[idx + 1]
        var nextMap = {}
        for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k) && k !== props.sessionId) nextMap[k] = map[k]
        if (next) nextMap[props.sessionId] = next
        props.onChange('sessions', nextMap)
      }
      return react.createElement('button', {
        type: 'button',
        onClick: cycle,
        title: '对话状态（点击切换：进行中 → 已结项 → 搁置中 → 无）',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '2px 8px', borderRadius: '999px', flex: 'none',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4))',
          background: 'transparent', fontSize: '11px',
          color: 'var(--dsw-alias-label-secondary, #9aa4b2)', cursor: 'pointer', lineHeight: '1.4',
        },
      },
        react.createElement('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: label ? (label.color || '#9ca3af') : 'var(--dsw-alias-border-l2, rgba(128,128,128,0.4))', flex: 'none' } }),
        react.createElement('span', null, label ? (label.name || key) : (typeof key === 'string' && key !== '' ? key : '未设置状态'))
      )
    }

    // ---------- 面板本体 ----------
    function MemoPanel(props) {
      // hooks 必须在条件 return 之前全部声明
      var open = react.useSyncExternalStore(subscribeOpen, getOpen)
      // useSessions 是框架注入的全局槽标准 hook（选择器订阅，变化自动重渲染）
      var sessionId = typeof props.useSessions === 'function'
        ? props.useSessions(function (s) { return s && s.current })
        : undefined
      if (!open) return null
      if (typeof sessionId !== 'string' || sessionId === '') {
        return react.createElement('div', { style: Object.assign({}, S.panel, { padding: '16px' }) },
          react.createElement('div', { style: S.reason }, '当前没有打开的对话会话')
        )
      }
      return react.createElement(PanelBody, {
        key: sessionId, // 切换会话时整体重挂载，避免备注/版本/标签草稿串会话
        sessionId: sessionId,
        memoScope: props.memoScope,
        statusScope: props.statusScope,
      })
    }

    function PanelBody(props) {
      var sessionId = props.sessionId
      var memoScope = props.memoScope
      var [data, setData] = react.useState(null)
      var [error, setError] = react.useState(null)
      var [loading, setLoading] = react.useState(true)
      var [nonce, setNonce] = react.useState(0)

      var memoSnap = react.useSyncExternalStore(
        function (fn) { return memoScope.subscribe(fn) },
        function () { return memoScope.getSnapshot() }
      )
      var statusSnap = react.useSyncExternalStore(
        function (fn) { return props.statusScope.subscribe(fn) },
        function () { return props.statusScope.getSnapshot() }
      )

      react.useEffect(function () {
        var cancelled = false
        setLoading(true)
        setError(null)
        probe(sessionId).then(function (res) {
          if (cancelled) return
          setData(res)
          setLoading(false)
        }, function (e) {
          if (cancelled) return
          setError(String(e && e.message ? e.message : e))
          setLoading(false)
        })
        return function () { cancelled = true }
      }, [sessionId, nonce])

      var memoValue = memoSnap && memoSnap.status === 'ready' ? memoSnap.value : undefined
      var ov = (memoValue && memoValue.overrides) || {}
      var per = ov[sessionId] || {}
      var note = typeof per.note === 'string' ? per.note : ''
      var markedPublished = typeof per.publishedAt === 'number' && per.publishedAt > 0
      var tags = ((memoValue && memoValue.tags) || {})[sessionId] || []

      function saveOverride(nextPer) {
        var nextOv = Object.assign({}, ov)
        if (nextPer === null || Object.keys(nextPer).length === 0) delete nextOv[sessionId]
        else nextOv[sessionId] = nextPer
        memoScope.set('overrides', nextOv).catch(function (e) {
          console.error('[dsh-session-memo] save overrides failed:', e)
        })
      }
      function saveTags(nextList) {
        var nextTags = Object.assign({}, (memoValue && memoValue.tags) || {})
        if (!Array.isArray(nextList) || nextList.length === 0) delete nextTags[sessionId]
        else nextTags[sessionId] = nextList
        memoScope.set('tags', nextTags).catch(function (e) {
          console.error('[dsh-session-memo] save tags failed:', e)
        })
      }

      var git = data ? data.git : null
      var npm = data ? data.npm : null

      return react.createElement('div', { style: S.panel },
        // header
        react.createElement('div', { style: S.header },
          react.createElement('span', { style: S.headerTitle }, '对话备忘录'),
          react.createElement(StatusPill, {
            sessionId: sessionId,
            statusSnap: statusSnap,
            onChange: function (field, value) {
              props.statusScope.set(field, value).catch(function (e) {
                console.error('[dsh-session-memo] save status failed:', e)
              })
            },
          }),
          react.createElement('button', {
            type: 'button', title: '重新探测', onClick: function () { setNonce(nonce + 1) },
            style: S.miniBtn,
          }, '⟳'),
          react.createElement('button', {
            type: 'button', title: '关闭', onClick: function () { setOpen(false) },
            style: S.miniBtn,
          }, '✕')
        ),
        // body
        react.createElement('div', { style: S.body },
          react.createElement('div', { style: S.reason },
            '会话 ' + shortId(sessionId) + (data && data.cwd ? ' · ' + data.cwd : '')
          ),
          error !== null
            ? react.createElement('div', { style: Object.assign({}, S.statusBox, { background: 'rgba(239,68,68,0.12)', color: COLOR_BAD, border: '1px solid rgba(239,68,68,0.35)' }) },
                '探测失败：' + error)
            : loading
              ? react.createElement('div', { style: S.statusBox }, '探测中…')
              : react.createElement(react.Fragment, null,
                  // GitHub 同步卡片（工作区多仓库时全部列出，可展开）
                  react.createElement(GitCard, { git: git }),
                  // npm 发布卡片（工作区多仓库时列出每个包的发布状态）
                  react.createElement(NpmCard, {
                    npm: npm,
                    markedPublished: markedPublished,
                    publishedAt: per.publishedAt,
                    fmtTs: fmtTs,
                    onToggleMark: function () {
                      if (markedPublished) {
                        var nextPer = Object.assign({}, per); delete nextPer.publishedAt; saveOverride(nextPer)
                      } else {
                        saveOverride(Object.assign({}, per, { publishedAt: Date.now() }))
                      }
                    },
                  }),
                  // 项目版本卡片（每个仓库的版本一一对应；手动覆盖作用于最近提交仓库）
                  react.createElement(VersionCard, {
                    repos: npm && Array.isArray(npm.repos) ? npm.repos : [],
                    per: per,
                    saveOverride: saveOverride,
                  }),
                  // 备注卡片
                  react.createElement('div', { style: S.card },
                    react.createElement('div', { style: S.cardTitle }, '备注'),
                    react.createElement('textarea', {
                      style: S.textarea,
                      placeholder: '自由备注（自动保存）…',
                      defaultValue: note,
                      onBlur: function (e) {
                        var v = e.target.value.trim()
                        if (v === '') {
                          var np2 = Object.assign({}, per); delete np2.note; saveOverride(np2)
                        } else {
                          saveOverride(Object.assign({}, per, { note: v }))
                        }
                      },
                    })
                  ),
                  // 备忘标签卡片
                  react.createElement('div', { style: S.card },
                    react.createElement('div', { style: S.cardTitle }, '备忘标签'),
                    react.createElement(TagsEditor, { tags: tags, onTags: saveTags })
                  )
                ),
          // footer
          react.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '2px' } },
            react.createElement('span', { style: S.reason }, '打开面板时自动探测'),
            react.createElement('button', { type: 'button', onClick: function () { setNonce(nonce + 1) }, style: S.primaryBtn }, '刷新')
          )
        )
      )
    }

    // ---------- 项目版本卡片（多仓库一一对应） ----------
    function VersionCard(props) {
      var repos = Array.isArray(props.repos) && props.repos.length > 0 ? props.repos : null
      var per = props.per || {}
      var primary = repos ? repos[0] : null
      var primaryAuto = primary && primary.version && primary.version.ok ? primary.version.version : null
      var overridden = typeof per.version === 'string' && per.version !== ''
      var effective = overridden ? per.version : primaryAuto
      var count = repos ? repos.length : 1
      function onCommit(v) {
        if (v === '') {
          var np = Object.assign({}, per); delete np.version; props.saveOverride(np)
        } else {
          props.saveOverride(Object.assign({}, per, { version: v }))
        }
      }
      return react.createElement('div', { style: S.card },
        react.createElement('div', { style: S.cardTitle }, '项目版本' + (count > 1 ? '（' + count + ' 个）' : '')),
        repos && repos.length > 1
          ? repos.map(function (entry) {
              var isPrimary = entry === primary
              var auto = entry.version && entry.version.ok ? entry.version.version : null
              return react.createElement('div', {
                key: entry.repoPath || 'ver',
                style: { borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))', padding: '3px 0' },
              },
                react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                  react.createElement('span', { style: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, repoName(entry)),
                  react.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #9aa4b2)', flex: 'none' } }, auto === null ? '—' : ('v' + auto)),
                  isPrimary && overridden
                    ? react.createElement('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9aa4b2)', flex: 'none' } }, '手动覆盖')
                    : null,
                  isPrimary
                    ? react.createElement('span', { style: { marginLeft: 'auto', fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9aa4b2)', flex: 'none' } }, '最近')
                    : null
                ),
                isPrimary
                  ? react.createElement(VersionInput, {
                      defaultValue: effective || '',
                      overridden: overridden,
                      autoHint: primaryAuto ? ('自动探测: ' + primaryAuto) : '无自动探测值',
                      onCommit: onCommit,
                    })
                  : null
              )
            })
          : react.createElement(react.Fragment, null,
              react.createElement('div', { style: S.row },
                react.createElement('span', { style: S.rowLabel }, '版本'),
                react.createElement('span', { style: Object.assign({}, S.rowValue, { fontWeight: 600 }) },
                  effective || '—',
                  overridden
                    ? react.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #9aa4b2)', fontWeight: 400, fontSize: '10px', marginLeft: '4px' } }, '手动覆盖')
                    : null
                )
              ),
              react.createElement(VersionInput, {
                defaultValue: effective || '',
                overridden: overridden,
                autoHint: primaryAuto ? ('自动探测: ' + primaryAuto) : '无自动探测值',
                onCommit: onCommit,
              })
            )
      )
    }

    function VersionInput(props) {
      var [draft, setDraft] = react.useState(props.defaultValue)
      react.useEffect(function () { setDraft(props.defaultValue) }, [props.defaultValue])
      return react.createElement(react.Fragment, null,
        react.createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
          react.createElement('input', {
            style: Object.assign({}, S.input, { marginTop: '0', flex: 'auto' }),
            value: draft,
            placeholder: props.autoHint,
            onChange: function (e) { setDraft(e.target.value) },
            onBlur: function () { if (draft.trim() !== props.defaultValue) props.onCommit(draft.trim()) },
            onKeyDown: function (e) { if (e.key === 'Enter') e.currentTarget.blur() },
          }),
          props.overridden
            ? react.createElement('button', {
                type: 'button', title: '恢复自动探测',
                onClick: function () { setDraft(''); props.onCommit('') },
                style: S.miniBtn,
              }, '恢复')
            : null
        )
      )
    }

    function TagsEditor(props) {
      var tags = props.tags || []
      var [input, setInput] = react.useState('')
      function add() {
        var v = input.trim()
        if (v === '') return
        if (tags.indexOf(v) === -1) props.onTags(tags.concat([v]))
        setInput('')
      }
      return react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        react.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } },
          tags.length === 0
            ? react.createElement('span', { style: S.reason }, '暂无标签')
            : tags.map(function (t) {
                return react.createElement('span', { key: t, style: S.chip },
                  t,
                  react.createElement('button', {
                    type: 'button', 'aria-label': '删除 ' + t, style: S.chipX,
                    onClick: function () { props.onTags(tags.filter(function (x) { return x !== t })) },
                  }, '×')
                )
              })
        ),
        react.createElement('div', { style: { display: 'flex', gap: '6px' } },
          react.createElement('input', {
            style: Object.assign({}, S.input, { marginTop: '0', flex: 'auto' }),
            value: input,
            placeholder: '添加标签，回车确认',
            onChange: function (e) { setInput(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') add() },
          }),
          react.createElement('button', { type: 'button', onClick: add, style: S.primaryBtn }, '添加')
        )
      )
    }

    // ---------- GitHub 同步卡片（工作区多仓库支持） ----------
    function repoName(repo) {
      var parts = String(repo.repoPath || '').split(/[\\/]/).filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : (repo.branch || 'repo')
    }
    function GitCard(props) {
      var git = props.git
      if (!git || !git.ok) {
        return react.createElement('div', { style: S.card },
          react.createElement('div', { style: S.cardTitle }, 'GitHub 同步'),
          react.createElement('div', { style: S.reason }, '— ' + reasonText(git && git.reason))
        )
      }
      var repos = Array.isArray(git.repos) && git.repos.length > 0 ? git.repos : [git]
      var [expanded, setExpanded] = react.useState(repos.length > 0 ? repos[0].repoPath : null)
      return react.createElement('div', { style: S.card },
        react.createElement('div', { style: S.cardTitle },
          'GitHub 同步' + (repos.length > 1 ? '（' + repos.length + ' 个仓库）' : '')
        ),
        repos.length === 1
          ? react.createElement(RepoDetails, { repo: repos[0] })
          : repos.map(function (repo) {
              return react.createElement(RepoRow, {
                key: repo.repoPath,
                repo: repo,
                expanded: expanded === repo.repoPath,
                onToggle: function () { setExpanded(expanded === repo.repoPath ? null : repo.repoPath) },
              })
            })
      )
    }
    function RepoRow(props) {
      var repo = props.repo
      var color = gitSyncColor(repo)
      return react.createElement('div', {
        style: {
          borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
          paddingBottom: '4px', marginBottom: '4px',
        },
      },
        react.createElement('button', {
          type: 'button',
          onClick: props.onToggle,
          title: repo.repoPath,
          style: {
            display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
            border: 'none', background: 'none', padding: '4px 0', cursor: 'pointer',
            color: 'inherit', fontSize: '12px', textAlign: 'left',
          },
        },
          react.createElement('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: color, flex: 'none' } }),
          react.createElement('span', { style: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, repoName(repo)),
          react.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #9aa4b2)', flex: 'none' } }, repo.branch || '—'),
          react.createElement('span', { style: Object.assign({}, { color: color, flex: 'none', marginLeft: 'auto' }) }, repo.remote ? (gitSyncLabel(repo) || '已同步') : '无远程'),
          react.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #9aa4b2)', flex: 'none' } }, props.expanded ? '▾' : '▸')
        ),
        props.expanded
          ? react.createElement('div', { style: { padding: '2px 0 6px' } }, react.createElement(RepoDetails, { repo: repo }))
          : null
      )
    }
    function RepoDetails(props) {
      var repo = props.repo
      var syncLabel = gitSyncLabel(repo)
      var syncColor = gitSyncColor(repo)
      return react.createElement(react.Fragment, null,
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '仓库'),
          react.createElement('span', { style: Object.assign({}, S.rowValue, { title: repo.repoPath || undefined }) },
            repo.repoPath ? shortPath(repo.repoPath) : (repo.detached ? '游离 HEAD' : '—')
          )
        ),
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '分支'),
          react.createElement('span', { style: S.rowValue },
            react.createElement('span', { style: { display: 'inline-flex', alignItems: 'center' } },
              react.createElement('span', { style: Object.assign({}, S.dot, { background: syncColor }) }),
              repo.branch || (repo.detached ? '游离 HEAD' : '—')
            )
          )
        ),
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '同步'),
          react.createElement('span', { style: Object.assign({}, S.rowValue, { color: syncColor }) },
            repo.remote ? (syncLabel || '已同步') : '无远程'
          )
        ),
        repo.upstream !== null && repo.upstream !== undefined
          ? react.createElement('div', { style: S.row },
              react.createElement('span', { style: S.rowLabel }, '上游'),
              react.createElement('span', { style: S.rowValue }, repo.upstream)
            )
          : null,
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '最近提交'),
          react.createElement('span', { style: S.rowValue },
            repo.lastCommit ? (repo.lastCommit.hash + (repo.lastCommit.date ? ' · ' + repo.lastCommit.date : '')) : '—'
          )
        ),
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '远程'),
          react.createElement('span', { style: S.rowValue }, repo.remote ? (repo.remote.name + ' ' + repo.remote.url) : '无远程')
        )
      )
    }

    // ---------- npm 发布卡片（工作区多仓库） ----------
    function npmStateColor(entry) {
      var n = entry && entry.npm
      if (!n || !n.ok) return 'var(--dsw-alias-label-secondary, #9aa4b2)'
      return n.behind ? COLOR_WARN : COLOR_SYNC
    }
    function npmStateText(entry) {
      var n = entry && entry.npm
      if (!n || !n.ok) return reasonText(n && n.reason)
      if (n.behind) return '落后 latest'
      if (n.published) return '已发布'
      return '本地超前'
    }
    function NpmCard(props) {
      var npm = props.npm
      var repos = npm && Array.isArray(npm.repos) && npm.repos.length > 0 ? npm.repos : null
      var title = 'npm 发布' + (repos && repos.length > 1 ? '（' + repos.length + ' 个包）' : '')
      var markLabel = props.markedPublished
        ? '已手动标记' + (typeof props.publishedAt === 'number' ? ' @ ' + props.fmtTs(props.publishedAt) : '')
        : '发布后手动记录'
      return react.createElement('div', { style: S.card },
        react.createElement('div', { style: S.cardTitle }, title),
        repos && repos.length > 1
          ? repos.map(function (entry) {
              return react.createElement(NpmRow, { key: entry.repoPath || 'npm-row', entry: entry })
            })
          : react.createElement(NpmDetails, {
              entry: repos && repos.length === 1 ? repos[0] : { repoPath: null, version: { ok: !!(npm && npm.ok), name: npm && npm.name, version: npm && npm.local }, npm: npm },
            }),
        react.createElement('div', { style: Object.assign({}, S.row, { marginTop: '6px' }) },
          react.createElement('span', { style: S.rowLabel }, markLabel),
          react.createElement('button', {
            type: 'button',
            onClick: props.onToggleMark,
            style: props.markedPublished ? S.miniBtn : S.primaryBtn,
          }, props.markedPublished ? '取消标记' : '标记已发布')
        )
      )
    }
    function NpmRow(props) {
      var entry = props.entry
      var n = entry && entry.npm
      var color = npmStateColor(entry)
      var v = entry && entry.version
      return react.createElement('div', {
        style: {
          padding: '3px 0',
          borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12))',
        },
      },
        react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          react.createElement('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: color, flex: 'none' } }),
          react.createElement('span', { style: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, repoName(entry)),
          react.createElement('span', { style: { color: color, flex: 'none', marginLeft: 'auto' } }, npmStateText(entry))
        ),
        n && n.ok
          ? react.createElement('div', { style: { paddingLeft: '14px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9aa4b2)' } },
              (n.name || '—') + '  ' + n.local + ' → ' + n.latest)
          : v && v.ok && v.name
            ? react.createElement('div', { style: { paddingLeft: '14px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9aa4b2)' } },
                v.name + '  ' + (v.version || '—'))
            : null
      )
    }
    function NpmDetails(props) {
      var n = props.entry && props.entry.npm
      if (!n || !n.ok) {
        return react.createElement(react.Fragment, null,
          react.createElement('div', { style: S.reason }, '— ' + reasonText(n && n.reason)),
          n && n.name
            ? react.createElement('div', { style: S.row },
                react.createElement('span', { style: S.rowLabel }, '包名'),
                react.createElement('span', { style: S.rowValue }, n.name)
              )
            : null
        )
      }
      return react.createElement(react.Fragment, null,
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '包名'),
          react.createElement('span', { style: S.rowValue }, n.name)
        ),
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '本地 / latest'),
          react.createElement('span', { style: S.rowValue }, n.local + ' / ' + n.latest)
        ),
        react.createElement('div', { style: S.row },
          react.createElement('span', { style: S.rowLabel }, '发布状态'),
          react.createElement('span', { style: Object.assign({}, S.rowValue, { color: n.behind ? COLOR_WARN : COLOR_SYNC }) },
            n.behind ? '落后 latest，可发布新版本' : (n.published ? '已发布（与 latest 一致）' : '本地超前于 registry')
          )
        )
      )
    }

    // ---------- apply ----------
    function apply(ctx) {
      var memoScope = ctx.settingsScope.bind({ namespace: 'dsh-session-memo' })
      var statusScope = ctx.settingsScope.bind({ namespace: 'dsh-session-status' })
      ctx.effect(function () {
        var dispose = ctx.slots.inject('conversation.session.header.actions', function () {
          return ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'dsh-session-memo', order: 100 },
            function (props) { return react.createElement(MemoButton, props) }
          )
        })
        return dispose
      }, 'dsh-session-memo: header action')
      ctx.effect(function () {
        var dispose = ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-session-memo', order: 100 },
            function (props) {
              return react.createElement(MemoPanel, {
                useSessions: props.useSessions,
                memoScope: memoScope,
                statusScope: statusScope,
              })
            }
          )
        })
        return dispose
      }, 'dsh-session-memo: overlay panel')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})

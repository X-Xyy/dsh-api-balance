/**
 * dsh-api-balance — browser half.
 *
 * Registers the live balance/usage chip in the conversation header and its
 * detail panel in the frame-wide overlay slot. Data comes from the Host half's
 * loopback route (`/dsh-api-balance/snapshot`); the page never sees the API key.
 *
 * This file is a client module bundle in the module-loader format: executing it
 * only registers the factory, and the module body (including style insertion)
 * runs on first import.
 */
window.__ModuleLoader__.load({
  id: "dsh-api-balance",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");

    const ENDPOINT = "/dsh-api-balance/snapshot";
    const POLL_MS = 20000;
    const REQUEST_TIMEOUT_MS = 25000;

    const CSS = [
      '.dsh-apibal-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums;transition:border-color .15s ease,background .15s ease;}',
      '.dsh-apibal-chip:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}',
      '.dsh-apibal-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.dsh-apibal-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-secondary);}',
      '.dsh-apibal-dot--ok{background:var(--dsw-alias-state-success-primary);}',
      '.dsh-apibal-dot--warn{background:var(--dsw-alias-state-warn-primary);}',
      '.dsh-apibal-dot--error{background:var(--dsw-alias-state-error-primary);}',
      '.dsh-apibal-dim{color:var(--dsw-alias-label-secondary);}',
      '.dsh-apibal-panel{position:fixed;top:60px;right:16px;z-index:2147483000;width:300px;box-sizing:border-box;pointer-events:auto;padding:12px 14px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 16px 40px rgba(0,0,0,.28);font-size:12px;line-height:1.55;}',
      '.dsh-apibal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}',
      '.dsh-apibal-title{font-weight:600;}',
      '.dsh-apibal-actions{display:flex;align-items:center;gap:4px;}',
      '.dsh-apibal-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;height:22px;padding:0 8px;font:inherit;font-size:11px;cursor:pointer;}',
      '.dsh-apibal-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}',
      '.dsh-apibal-btn[disabled]{opacity:.55;cursor:default;}',
      '.dsh-apibal-hero{display:flex;align-items:baseline;gap:8px;margin:2px 0 6px;}',
      '.dsh-apibal-amount{font-size:24px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;}',
      '.dsh-apibal-badge{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);}',
      '.dsh-apibal-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:1px 0;}',
      '.dsh-apibal-row-value{font-variant-numeric:tabular-nums;}',
      '.dsh-apibal-split{height:1px;margin:9px 0;background:var(--dsw-alias-border-l1);}',
      '.dsh-apibal-section{font-weight:600;margin-bottom:4px;}',
      '.dsh-apibal-bar{height:6px;border-radius:3px;margin-top:6px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}',
      '.dsh-apibal-bar-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);}',
      '.dsh-apibal-note{margin-top:8px;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;}',
      '.dsh-apibal-error{margin:6px 0;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);word-break:break-word;}',
    ].join('')

    function insertStyles(css) {
      const element = document.createElement('style')
      element.setAttribute('data-dsh-api-balance', '')
      element.textContent = css
      document.head.appendChild(element)
      return () => { element.remove() }
    }

    function formatInteger(value) {
      const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
      return String(number).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
    }

    function formatCompact(value) {
      const number = typeof value === 'number' && Number.isFinite(value) ? value : 0
      if (number < 1000) return String(Math.round(number))
      if (number < 1000000) return (number / 1000).toFixed(1) + 'k'
      return (number / 1000000).toFixed(2) + 'M'
    }

    function formatClock(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const date = new Date(ms)
      const pad = (value) => (value < 10 ? '0' : '') + String(value)
      return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    }

    function currencySymbol(code) {
      if (code === 'CNY') return '\u00a5'
      if (code === 'USD') return '$'
      return ''
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      ctx.effect(() => insertStyles(CSS), 'dsh-api-balance: styles')

      const state = {
        balance: null,
        usage: null,
        phase: 'loading',
        error: '',
        refreshing: false,
        open: false,
        updatedAt: 0,
      }
      const listeners = new Set()
      let activeSessionId = ''
      let mountedChips = 0
      let inFlight = false

      const publish = (patch) => {
        const keys = Object.keys(patch)
        for (let index = 0; index < keys.length; index += 1) state[keys[index]] = patch[keys[index]]
        const targets = Array.from(listeners)
        for (let index = 0; index < targets.length; index += 1) targets[index]()
      }

      const subscribe = (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }

      const useSnapshot = () => {
        const [revision, setRevision] = React.useState(0)
        React.useEffect(() => subscribe(() => setRevision((value) => value + 1)), [])
        return state
      }

      const refresh = async (force) => {
        if (inFlight) return
        inFlight = true
        publish({ refreshing: true })
        const controller = new AbortController()
        const cancel = ctx.timeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          const query = '?sessionId=' + encodeURIComponent(activeSessionId) + (force === true ? '&force=1' : '')
          const response = await fetch(ENDPOINT + query, { signal: controller.signal, headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error('HTTP ' + String(response.status))
          const payload = await response.json()
          const balance = payload !== null && typeof payload === 'object' && payload.balance !== undefined ? payload.balance : null
          const ok = balance !== null && balance.ok === true
          publish({
            phase: ok ? 'ok' : 'error',
            error: ok ? '' : (balance !== null && typeof balance.error === 'string' && balance.error !== '' ? balance.error : '余额查询失败'),
            balance: balance,
            usage: payload !== null && typeof payload === 'object' && payload.usage !== undefined ? payload.usage : null,
            updatedAt: payload !== null && typeof payload === 'object' && typeof payload.updatedAt === 'number' ? payload.updatedAt : Date.now(),
            refreshing: false,
          })
        } catch (error) {
          publish({
            phase: 'error',
            error: error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error),
            refreshing: false,
          })
        } finally {
          cancel()
          inFlight = false
        }
      }

      ctx.effect(() => ctx.interval(() => {
        if (mountedChips > 0 || state.open === true) refresh(false)
      }, POLL_MS), 'dsh-api-balance: poll')

      function toneOf(snapshot) {
        const balance = snapshot.balance
        if (balance === null || balance.ok !== true) return snapshot.updatedAt === 0 ? 'idle' : 'error'
        return balance.available === true ? 'ok' : 'warn'
      }

      function balanceLabelOf(snapshot) {
        const balance = snapshot.balance
        if (balance !== null && balance.ok === true) return currencySymbol(balance.currency) + balance.total
        if (snapshot.updatedAt === 0) return '余额 …'
        return '余额不可用'
      }

      function row(label, value) {
        return React.createElement('div', { className: 'dsh-apibal-row', key: label },
          React.createElement('span', { className: 'dsh-apibal-dim' }, label),
          React.createElement('span', { className: 'dsh-apibal-row-value' }, value))
      }

      function BalanceChip(props) {
        const snapshot = useSnapshot()
        const sessionId = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''

        React.useEffect(() => {
          mountedChips += 1
          activeSessionId = sessionId
          refresh(false)
          return () => { mountedChips -= 1 }
        }, [sessionId])

        const balance = snapshot.balance
        const live = balance !== null && balance.ok === true
        const usage = snapshot.usage
        const usageLabel = usage !== null && usage !== undefined ? formatCompact(usage.total) + ' tok' : ''
        const title = live
          ? 'DeepSeek 余额 ' + currencySymbol(balance.currency) + balance.total + (usageLabel === '' ? '' : ' \u00b7 本会话 ' + usageLabel) + ' \u00b7 点击查看详情'
          : 'DeepSeek 余额与用量 \u00b7 点击查看详情'

        return React.createElement('button', {
          type: 'button',
          className: 'dsh-apibal-chip',
          title: title,
          'aria-label': 'DeepSeek API 余额与用量',
          onClick: () => {
            const next = state.open !== true
            publish({ open: next })
            if (next) refresh(true)
          },
        },
          React.createElement('span', { className: 'dsh-apibal-dot dsh-apibal-dot--' + toneOf(snapshot) }),
          React.createElement('span', null, balanceLabelOf(snapshot)),
          usageLabel === '' ? null : React.createElement('span', { className: 'dsh-apibal-dim' }, '\u00b7'),
          usageLabel === '' ? null : React.createElement('span', null, usageLabel))
      }

      function BalancePanel() {
        const snapshot = useSnapshot()
        if (snapshot.open !== true) return null

        const balance = snapshot.balance
        const live = balance !== null && balance.ok === true
        const usage = snapshot.usage
        const children = []

        children.push(React.createElement('div', { className: 'dsh-apibal-head', key: 'head' },
          React.createElement('span', { className: 'dsh-apibal-title' }, 'DeepSeek API 余额与用量'),
          React.createElement('span', { className: 'dsh-apibal-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'dsh-apibal-btn',
              disabled: snapshot.refreshing === true,
              onClick: () => { refresh(true) },
            }, snapshot.refreshing === true ? '刷新中' : '刷新'),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-apibal-btn',
              onClick: () => { publish({ open: false }) },
            }, '关闭'))))

        if (snapshot.error !== '') {
          children.push(React.createElement('div', { className: 'dsh-apibal-error', key: 'error' }, snapshot.error))
        }

        if (live) {
          children.push(React.createElement('div', { className: 'dsh-apibal-hero', key: 'hero' },
            React.createElement('span', { className: 'dsh-apibal-amount' }, currencySymbol(balance.currency) + balance.total),
            React.createElement('span', { className: 'dsh-apibal-badge' }, balance.available === true ? '可用' : '不可用')))
          children.push(React.createElement('div', { key: 'balance-rows' },
            row('充值余额', currencySymbol(balance.currency) + balance.toppedUp),
            row('赠送余额', currencySymbol(balance.currency) + balance.granted)))
        }

        children.push(React.createElement('div', { className: 'dsh-apibal-split', key: 'split' }))

        if (usage === null || usage === undefined) {
          children.push(React.createElement('div', { className: 'dsh-apibal-dim', key: 'no-session' }, '当前没有活动会话，暂无用量数据。'))
        } else {
          children.push(React.createElement('div', { className: 'dsh-apibal-section', key: 'usage-title' }, '本会话用量'))
          children.push(React.createElement('div', { key: 'usage-rows' },
            row('模型', usage.model === '' ? '—' : usage.provider + ' \u00b7 ' + usage.model),
            row('请求次数', formatInteger(usage.calls) + ' 次'),
            row('输入 tokens', formatInteger(usage.input)),
            row('输出 tokens', formatInteger(usage.output)),
            row('缓存命中 tokens', formatInteger(usage.cacheRead)),
            row('合计 tokens', formatInteger(usage.total))))

          if (usage.contextWindow > 0 && usage.contextTokens > 0) {
            const percent = Math.min(100, Math.round((usage.contextTokens / usage.contextWindow) * 100))
            children.push(React.createElement('div', { key: 'context' },
              React.createElement('div', { className: 'dsh-apibal-row' },
                React.createElement('span', { className: 'dsh-apibal-dim' }, '上下文占用'),
                React.createElement('span', { className: 'dsh-apibal-row-value' }, formatCompact(usage.contextTokens) + ' / ' + formatCompact(usage.contextWindow) + ' (' + percent + '%)')),
              React.createElement('div', { className: 'dsh-apibal-bar' },
                React.createElement('div', { className: 'dsh-apibal-bar-fill', style: { width: percent + '%' } }))))
          }
        }

        children.push(React.createElement('div', { className: 'dsh-apibal-note', key: 'note' },
          '更新于 ' + formatClock(snapshot.updatedAt) + ' \u00b7 每 20 秒自动刷新'))
        if (live) {
          children.push(React.createElement('div', { className: 'dsh-apibal-note', key: 'source' },
            '余额来自 ' + balance.host + '/user/balance'))
        }

        return React.createElement('div', { className: 'dsh-apibal-panel' }, children)
      }

      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'api-balance', order: 10, label: 'API 余额' },
        BalanceChip,
      ))

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'api-balance-panel', order: 100 },
        BalancePanel,
      ))
    }

    exports.name = "dsh-api-balance";
    exports.inject = ["slots", "timer"];
    exports.apply = apply;
    return module.exports;
  },
});

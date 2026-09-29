const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, shell, screen, powerMonitor } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { execFile, execFileSync } = require('node:child_process')

const { getBattery, refreshDesign, refreshDetailed } = require('./battery.cjs')
const { batteryIconBuffer } = require('./icon.cjs')

// 不要在未打包阶段设置自定义 AppUserModelID：Windows 只给"已注册"的 AppID 投递通知，
// 自定义的没注册会被系统静默丢弃。保持默认，通知才能正常弹出。
const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:5178'
const START_HIDDEN = process.argv.includes('--hidden')

// 窗口基准尺寸：拖拽拉伸一律禁止，只允许标题栏的最大化 / 还原
const WINDOW_W = 1000
const WINDOW_H = 630

const RUN_NAME = 'BatteryGuard'

function appDir() {
  return path.resolve(__dirname, '..').replace(/[\\/]+$/, '')
}

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')
const STATS_FILE = path.join(app.getPath('userData'), 'stats.json')

const DEFAULT_CONFIG = {
  upperLimit: 80,
  lowerLimit: 30,
  notifyEnabled: true,
  notifyChannel: 'powershell',
  upperEnabled: true,
  lowerEnabled: true,
  autoLaunch: false,
  pollIntervalMs: 5000,
  alertCooldownMs: 5 * 60 * 1000,
  minimizeToTray: true
}

function loadJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch {
    return { ...fallback }
  }
}
function saveJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('[config] save failed', e.message)
  }
}

let config = loadJson(CONFIG_FILE, DEFAULT_CONFIG)
let stats = loadJson(STATS_FILE, {})

let win = null
let tray = null
let timer = null
let lastBattery = null
let windowVisible = false
const alerted = { upper: 0, lower: 0 }

// 窗口隐藏时没人看界面，轮询降频到 30 秒；显示时按用户配置（默认 5 秒）。
// 满电静置时长按 tick 间时间差累计，降频不影响统计精度。
function currentInterval() {
  const base = Math.max(2000, config.pollIntervalMs)
  return windowVisible ? base : Math.max(30000, base * 6)
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function ensureToday() {
  const k = todayKey()
  if (!stats[k]) stats[k] = { fullSoakMs: 0, chargeCount: 0, alerts: 0, peakPercent: null }
  return stats[k]
}

function createWindow(opts = {}) {
  const hidden = !!opts.hidden
  win = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0B0C0E',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const distIndex = path.join(__dirname, '..', 'dist', 'index.html')
  if (fs.existsSync(distIndex)) {
    win.loadFile(distIndex)
  } else {
    win.loadURL(DEV_URL)
  }

  win.webContents.on('console-message', (_e, level, message) => {
    if (isDev) console.log('[renderer]', message)
  })

  // 窗口固定尺寸：拦截手动拖拽拉伸；最大化 / 还原走标题栏按钮，予以放行
  // 最大化判定必须对照屏幕工作区，不能用"比基准大一点"——否则手动拖大也会被误放行
  win.on('will-resize', (e, newBounds) => {
    const wa = screen.getPrimaryDisplay().workArea
    const isMaximize = newBounds.width >= wa.width - 10 && newBounds.height >= wa.height - 10
    const isRestore =
      win.isMaximized() &&
      Math.abs(newBounds.width - WINDOW_W) < 24 &&
      Math.abs(newBounds.height - WINDOW_H) < 24
    if (isMaximize || isRestore) return
    e.preventDefault()
  })

  // 后备保险：若个别环境 will-resize 未生效，任何偏离基准尺寸的普通 resize 都强制拉回
  // （最大化 / 最小化状态除外），setSize 到位后事件不再触发，无死循环
  win.on('resize', () => {
    if (win.isMaximized() || win.isMinimized() || win.isFullScreen()) return
    const [w, h] = win.getSize()
    if (w !== WINDOW_W || h !== WINDOW_H) {
      win.setSize(WINDOW_W, WINDOW_H)
    }
  })

  win.once('ready-to-show', () => { if (!hidden && !START_HIDDEN) win.show() })
  // 窗口可见性决定轮询频率：重新显示立即补一次 tick 并恢复高频，隐藏则降频
  win.on('show', () => { windowVisible = true; scheduleNext(); tick() })
  win.on('hide', () => { windowVisible = false; scheduleNext() })
  win.on('close', (e) => {
    if (config.minimizeToTray && !(global.__forceQuit)) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => { win = null })
}

// 托盘刷新加缓存：图标只在 电量/充放电/通电 任一变化时重新生成并 setImage，
// tooltip 只在文本变化时更新。setImage 会触发系统托盘重绘，每 5 秒无意义地刷很费电。
const trayCache = { key: null, tip: null }

function updateTray(bat) {
  if (!tray) return
  const pct = bat?.percent ?? null
  const charging = !!bat?.charging
  const key = `${pct}|${charging}|${!!bat?.powerOnline}`
  if (key !== trayCache.key) {
    const buf = batteryIconBuffer(pct, charging)
    tray.setImage(nativeImage.createFromBuffer(buf))
    trayCache.key = key
  }
  const state = charging ? '充电中' : bat?.powerOnline ? '已接通电源' : '使用电池'
  const tip = `电池守护 · ${pct ?? '--'}% · ${state}`
  if (tip !== trayCache.tip) {
    tray.setToolTip(tip)
    trayCache.tip = tip
  }
}

let menuPct = null

function buildTrayMenu() {
  const pct = lastBattery?.percent ?? '--'
  menuPct = pct
  return Menu.buildFromTemplate([
    { label: `电量 ${pct}%`, enabled: false },
    { type: 'separator' },
    { label: '打开主界面', click: () => { win ? (win.show(), win.focus()) : createWindow() } },
    {
      label: `上限提醒（${config.upperLimit}%）`,
      type: 'checkbox',
      checked: config.upperEnabled,
      click: () => { config.upperEnabled = !config.upperEnabled; saveJson(CONFIG_FILE, config); buildTrayMenu() }
    },
    {
      label: `下限提醒（${config.lowerLimit}%）`,
      type: 'checkbox',
      checked: config.lowerEnabled,
      click: () => { config.lowerEnabled = !config.lowerEnabled; saveJson(CONFIG_FILE, config); buildTrayMenu() }
    },
    { type: 'separator' },
    { label: '退出', click: () => { global.__forceQuit = true; app.quit() } }
  ])
}

// 未打包的 Electron 在 Windows 上没有开始菜单快捷方式，系统不会投递它的通知
// （show 事件照常触发，但界面上什么都看不到）。所以主通道用 PowerShell 发原生 Toast。
const TOAST_APPID_PS = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
const TOAST_APPID_OWN = 'BatteryGuard'

async function ensureOwnAppId() {
  return psRun(`
New-Item -Path 'HKCU:\\Software\\Classes\\AppUserModel\\Applications\\${TOAST_APPID_OWN}' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\AppUserModel\\Applications\\${TOAST_APPID_OWN}' -Name 'DisplayName' -Value '电池守护' -Type String -Force
Write-Output 'OK'
`)
}

function toastNotify(title, body, appId) {
  const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $t = [System.Security.SecurityElement]::Escape('${esc(title)}')
  $b = [System.Security.SecurityElement]::Escape('${esc(body)}')
  $xml = "<toast><visual><binding template='ToastText02'><text id='1'>$t</text><text id='2'>$b</text></binding></visual></toast>"
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($xml)
  $n = New-Object Windows.UI.Notifications.ToastNotification $doc
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Show($n)
  Write-Output 'OK'
} catch { Write-Output ('ERR:' + $_.Exception.Message) }
`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve({ ok: false, channel: 'toast', appId, error: err.message })
        const out = String(stdout || '').trim()
        resolve({ ok: out.startsWith('OK'), channel: 'toast', appId, detail: out })
      }
    )
  })
}

function electronNotify(title, body) {
  if (!Notification.isSupported()) {
    return Promise.resolve({ ok: false, channel: 'electron', reason: 'unsupported' })
  }
  return new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    try {
      const n = new Notification({ title, body, silent: false })
      n.on('show', () => done({ ok: true, channel: 'electron' }))
      n.on('failed', (_e, err) => done({ ok: false, channel: 'electron', error: String(err) }))
      n.show()
      // 实测：未打包时可能触发 show 但系统不投递，1.5 秒没结果就判定失败
      setTimeout(() => { if (!settled) done({ ok: false, channel: 'electron', note: 'silent' }) }, 1500)
    } catch (e) {
      done({ ok: false, channel: 'electron', error: e.message })
    }
  })
}

async function sendNotification(title, body) {
  if (!config.notifyEnabled) return { ok: false, reason: 'notify-disabled' }
  const ch = config.notifyChannel || 'powershell'
  if (ch === 'electron') return electronNotify(title, body)
  if (ch === 'own') {
    await ensureOwnAppId()
    return toastNotify(title, body, TOAST_APPID_OWN)
  }
  return toastNotify(title, body, TOAST_APPID_PS)
}

async function fireAlert(kind, title, body, force = false) {
  const now = Date.now()
  if (!force && now - (alerted[kind] || 0) < config.alertCooldownMs) return
  alerted[kind] = now

  const notify = await sendNotification(title, body)
  if (!notify.ok) console.error('[notify] 系统通知发送失败:', JSON.stringify(notify))

  ensureToday().alerts += 1
  saveJson(STATS_FILE, stats)
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:alert', { kind, title, body, at: now, notify })
  }
}

function evaluate(bat) {
  if (!bat || bat.percent == null) return
  const today = ensureToday()
  if (today.peakPercent == null || bat.percent > today.peakPercent) {
    today.peakPercent = bat.percent
    saveJson(STATS_FILE, stats)
  }

  // 满电静置：高电量 + 插电 + 未在充电，这是真正加速老化的状态
  if (bat.powerOnline && !bat.charging && bat.percent >= 95) {
    const last = lastBattery?.updatedAt
    if (last) today.fullSoakMs += Math.max(0, bat.updatedAt - last)
    saveJson(STATS_FILE, stats)
  }

  if (config.upperEnabled && bat.charging && bat.percent >= config.upperLimit) {
    fireAlert('upper', `已充到 ${bat.percent}%`, `达到上限 ${config.upperLimit}%，可以拔掉电源了`)
  } else if (config.lowerEnabled && !bat.powerOnline && bat.percent <= config.lowerLimit) {
    fireAlert('lower', `电量只剩 ${bat.percent}%`, `低于下限 ${config.lowerLimit}%，该接上电源了`)
  }
}

let busy = false
async function tick() {
  if (busy) return
  busy = true
  try {
    const bat = await getBattery()
    const prevCharging = lastBattery?.charging
    if (bat.charging && prevCharging === false) {
      ensureToday().chargeCount += 1
      saveJson(STATS_FILE, stats)
    }
    lastBattery = bat
    evaluate(bat)
    updateTray(bat)
    // 窗口隐藏时渲染进程不用刷新界面，跳过 IPC 推送（省下 Vue 重渲染的 CPU）
    if (win && !win.isDestroyed() && windowVisible) {
      win.webContents.send('battery:update', bat)
    }
    // 右键菜单只在电量数字变化时才重建
    if (tray && (bat?.percent ?? '--') !== menuPct) tray.setContextMenu(buildTrayMenu())
  } catch (e) {
    console.error('[battery] tick failed', e.message)
  } finally {
    busy = false
  }
}

// 用 setTimeout 链替代 setInterval：间隔随窗口可见性动态变化，
// 且 tick 执行耗时不计入等待，不会出现"执行慢导致间隔被吃掉"的堆积
function scheduleNext() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    await tick()
    scheduleNext()
  }, currentInterval())
}

function startTimer() {
  scheduleNext()
}

// Electron 的 setLoginItemSettings 在未打包时会写成一个认不出来的启动项，
// 而且不带应用路径参数，开机只会拉起空壳。直接写注册表 Run 键更可靠，
// 任务管理器的"启动"里会明确显示 BatteryGuard。
const RUN_PS = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

function psRun(script, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true, timeout },
      (err, stdout) => resolve({ ok: !err, out: String(stdout || '').trim(), error: err ? err.message : null })
    )
  })
}

// 查询失败时返回 null，避免用错误结果覆盖界面状态
async function queryAutoLaunch() {
  const r = await psRun(`
$v = Get-ItemProperty -Path '${RUN_PS}' -Name '${RUN_NAME}' -ErrorAction SilentlyContinue
if ($v -and $v.${RUN_NAME}) { Write-Output ('FOUND:' + $v.${RUN_NAME}) } else { Write-Output 'NONE' }
`)
  if (!r.ok) return null
  return r.out.startsWith('FOUND')
}

async function applyAutoLaunch() {
  const enabled = !!config.autoLaunch
  const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''")
  // 路径不能带尾部反斜杠，否则引号被转义、命令解析错乱
  const cmd = `"${process.execPath}" "${appDir()}" --hidden`
  const script = enabled
    ? `Set-ItemProperty -Path '${RUN_PS}' -Name '${RUN_NAME}' -Value '${esc(cmd)}' -Type String -Force; Write-Output 'OK'`
    : `Remove-ItemProperty -Path '${RUN_PS}' -Name '${RUN_NAME}' -Force -ErrorAction SilentlyContinue; Write-Output 'OK'`
  const r = await psRun(script)
  if (!r.ok || !r.out.includes('OK')) {
    console.error('[autolaunch] 写注册表失败:', JSON.stringify(r))
    return { ok: false, error: r.error || r.out }
  }
  return { ok: true, enabled }
}

const singleLock = app.requestSingleInstanceLock()
if (!singleLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus() }
  })

  app.whenReady().then(async () => {
    if (process.argv.includes('--self-test')) {
      await tick()
      updateTray(lastBattery)
      console.log('[selftest] battery =', JSON.stringify(lastBattery))
      console.log('[selftest] tray icon bytes =', batteryIconBuffer(lastBattery?.percent ?? null, false).length)
      console.log('[selftest] notification supported =', Notification.isSupported())

      if (process.argv.includes('--notify')) {
        const r = await sendNotification('电池守护 · 自检通知', '看到这条说明系统通知通道正常')
        console.log('[selftest] notify =', JSON.stringify(r))
      }

      const before = queryAutoLaunch()
      config.autoLaunch = true
      const wrote = applyAutoLaunch()
      const after = queryAutoLaunch()
      config.autoLaunch = false
      applyAutoLaunch()
      const cleared = queryAutoLaunch()
      console.log('[selftest] autolaunch: before=%s write=%s after=%s cleared=%s',
        before, JSON.stringify(wrote), after, cleared)

      setTimeout(() => app.exit(0), 300)
      return
    }

    // --screenshot <路径>：启动后截一张主界面存成 PNG（README / 宣传图用）
    // 会等电池报告解析完（约 10 秒）再截，保证健康度、循环次数这些字段不是空的
    if (process.argv.includes('--screenshot')) {
      const i = process.argv.indexOf('--screenshot')
      const out = process.argv[i + 1] || path.join(appDir(), 'docs', 'screenshot.png')
      createWindow()
      await tick()
      const deadline = Date.now() + 25000
      while (!(lastBattery && lastBattery.cycleCount != null) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500))
        await tick()
      }
      await new Promise((r) => setTimeout(r, 800))
      const img = await win.webContents.capturePage()
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, img.toPNG())
      const s = img.getSize()
      console.log('[screenshot] saved =', out, `${s.width}x${s.height}`)
      app.exit(0)
      return
    }

    if (process.argv.includes('--smoke')) {
      createWindow({ hidden: true })
      await tick()
      await new Promise((r) => setTimeout(r, 3000))
      console.log('[smoke] battery =', JSON.stringify(lastBattery))
      console.log('[smoke] renderer alive =', !!(win && !win.isDestroyed()))

      // 性能验证：连跑 5 次 tick 看平均耗时（快通道应为毫秒级）
      const times = []
      for (let i = 0; i < 5; i++) {
        const t0 = process.hrtime.bigint()
        await tick()
        times.push(Number(process.hrtime.bigint() - t0) / 1e6)
      }
      console.log('[smoke] tick times (ms) =', times.map((t) => t.toFixed(2)).join(', '))
      console.log('[smoke] interval visible/hidden =', config.pollIntervalMs, '/', Math.max(30000, config.pollIntervalMs * 6))

      const m = await win.webContents.executeJavaScript(`
        (() => {
          const app = document.querySelector('.app')
          const sel = document.querySelector('.row.wide select')
          const card = sel ? sel.closest('.card') : null
          let selectOk = null, btnOk = null
          if (sel && card) {
            const s = sel.getBoundingClientRect()
            const c = card.getBoundingClientRect()
            selectOk = s.right <= c.right + 1 && s.left >= c.left - 1
          }
          const btnRow = document.querySelector('.btn-row')
          const fn = document.querySelector('.footnote')
          if (btnRow && fn) {
            const b = btnRow.getBoundingClientRect()
            const f = fn.getBoundingClientRect()
            btnOk = b.bottom <= f.top + 1
          }
          return {
            win: window.innerWidth + 'x' + window.innerHeight,
            appH: app ? app.clientHeight : -1,
            appScrollH: app ? app.scrollHeight : -1,
            overflow: app ? app.scrollHeight > app.clientHeight + 1 : null,
            selectOk,
            btnOk
          }
        })()
      `)
      console.log('[smoke] layout =', JSON.stringify(m))

      // 验证配置落盘 + 开机自启写注册表
      config.autoLaunch = true
      saveJson(CONFIG_FILE, config)
      const write = await applyAutoLaunch()
      const has = await queryAutoLaunch()
      console.log('[smoke] configFileExists =', fs.existsSync(CONFIG_FILE))
      console.log('[smoke] autolaunch write =', JSON.stringify(write))
      console.log('[smoke] regHasEntry =', has)
      console.log('[smoke] regValue =', await psRun(`(Get-ItemProperty -Path '${RUN_PS}' -Name '${RUN_NAME}' -ErrorAction SilentlyContinue).${RUN_NAME}`).then((r) => r.out))

      config.autoLaunch = false
      await applyAutoLaunch()
      console.log('[smoke] afterCleanup regHasEntry =', await queryAutoLaunch())

      if (process.argv.includes('--notify')) {
        for (const ch of ['powershell', 'own', 'electron']) {
          config.notifyChannel = ch
          const r = await sendNotification('电池守护 · 通道测试', `当前通道：${ch}，看到这条说明该通道可用`)
          console.log('[smoke] notify', ch, '=', JSON.stringify(r))
          await new Promise((res) => setTimeout(res, 2500))
        }
      }

      app.exit(0)
      return
    }

    const buf = batteryIconBuffer(null, false)
    tray = new Tray(nativeImage.createFromBuffer(buf))
    tray.setToolTip('电池守护')
    tray.setContextMenu(buildTrayMenu())
    tray.on('click', () => { win ? (win.show(), win.focus()) : createWindow() })

    createWindow()
    await applyAutoLaunch()
    await tick()
    startTimer()
    // 设计容量要跑 powercfg（约 10 秒），放后台补，完成后再推一次完整数据
    refreshDesign(() => tick())

    // 事件驱动：插拔电源、睡眠恢复时立即刷新并强补一次慢读（功率方向变了），
    // 不等下一个轮询周期，托盘图标和提醒实时跟手
    powerMonitor.on('on-ac', () => { refreshDetailed(true).then(() => tick()) })
    powerMonitor.on('on-battery', () => { refreshDetailed(true).then(() => tick()) })
    powerMonitor.on('resume', () => { refreshDetailed(true).then(() => tick()) })
  })

  app.on('window-all-closed', () => {
    // 托盘常驻
  })
  app.on('before-quit', () => { global.__forceQuit = true })
}

ipcMain.handle('battery:get', async () => {
  if (!lastBattery) await tick()
  return lastBattery
})
ipcMain.handle('config:get', async () => {
  // 以注册表实际状态为准，避免界面开关和真实自启状态不一致
  const actual = await queryAutoLaunch()
  if (actual !== null) config.autoLaunch = actual
  return { ...config, launchStatus: { openAtLogin: !!config.autoLaunch, viaRegistry: true } }
})
ipcMain.handle('config:set', async (_e, patch) => {
  const before = config.pollIntervalMs
  config = { ...config, ...(patch || {}) }
  saveJson(CONFIG_FILE, config)
  if (patch && 'autoLaunch' in patch) {
    await applyAutoLaunch()
    const actual = await queryAutoLaunch()
    if (actual !== null) config.autoLaunch = actual
    saveJson(CONFIG_FILE, config)
  }
  if (config.pollIntervalMs !== before) startTimer()
  if (tray) tray.setContextMenu(buildTrayMenu())
  updateTray(lastBattery)
  return { ...config }
})
ipcMain.handle('stats:get', () => ({ today: ensureToday(), all: stats, todayKey: todayKey() }))
ipcMain.handle('app:open-report', async () => {
  const file = path.join(app.getPath('temp'), 'battery-guard-report.html')
  try {
    execFileSync('powercfg', ['/batteryreport', '/output', file], { windowsHide: true })
    shell.openPath(file)
    return { ok: true, file }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
ipcMain.handle('app:test-alert', async () => {
  const r = await sendNotification('电池守护 · 测试提醒', '提醒通道工作正常，到阈值时会这样通知你')
  if (!r.ok) console.error('[notify] 测试通知失败:', JSON.stringify(r))
  return r
})
ipcMain.on('app:quit', () => { global.__forceQuit = true; app.quit() })

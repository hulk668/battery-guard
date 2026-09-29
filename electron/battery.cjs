const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readFast } = require('./winapi.cjs')

const PS = 'powershell.exe'

function runPs(script, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(
      PS,
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 8 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message))
        resolve(stdout)
      }
    )
  })
}

// 从 root\WMI 读取高精度电池状态（mWh 级），失败时回退到 Win32_Battery
const PS_BATTERY = `
$ErrorActionPreference = 'Stop'
try {
  $bs = @(Get-CimInstance -Namespace root\\WMI -Class BatteryStatus -ErrorAction Stop)
  $fs = @(Get-CimInstance -Namespace root\\WMI -Class BatteryFullChargedCapacity -ErrorAction Stop)
  if ($bs.Count -eq 0) { throw 'no BatteryStatus instance' }
  $remaining = [int](($bs | Measure-Object -Property RemainingCapacity -Sum).Sum)
  $full      = [int](($fs | Measure-Object -Property FullChargedCapacity -Sum).Sum)
  $first     = $bs[0]
  [pscustomobject]@{
    source          = 'root/WMI'
    powerOnline     = [bool]$first.PowerOnline
    charging        = [bool]$first.Charging
    discharging     = [bool]$first.Discharging
    critical        = [bool]$first.Critical
    remaining       = $remaining
    full            = $full
    voltage         = [int]$first.Voltage
    chargeRate      = [int]$first.ChargeRate
    dischargeRate   = [int]$first.DischargeRate
  } | ConvertTo-Json -Compress
} catch {
  $b = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1
  $pct = [int]$b.EstimatedChargeRemaining
  [pscustomobject]@{
    source        = 'Win32_Battery'
    powerOnline   = $null
    charging      = ($b.BatteryStatus -eq 2)
    discharging   = ($b.BatteryStatus -eq 1)
    critical      = ($b.BatteryStatus -eq 5)
    remaining     = $null
    full          = $null
    voltage       = [int]$b.DesignVoltage
    chargeRate    = $null
    dischargeRate = $null
    percent       = $pct
  } | ConvertTo-Json -Compress
}
`

async function readBatteryRaw() {
  const out = await runPs(PS_BATTERY)
  const text = out.trim()
  if (!text) throw new Error('empty battery response')
  return JSON.parse(text)
}

// 解析 powercfg /batteryreport，拿到设计容量与循环次数（本机 BatteryStaticData 为空，只能走这里）
async function readDesignInfo() {
  const tmp = path.join(os.tmpdir(), `battery-report-${process.pid}.html`)
  await runPs(`powercfg /batteryreport /output "${tmp}" /duration 14`, 30000)
  let html = ''
  try {
    const buf = fs.readFileSync(tmp)
    // powercfg 输出为 UTF-16LE（带 BOM），其余情况按 UTF-8 兜底
    if (buf.length > 1 && buf[0] === 0xff && buf[1] === 0xfe) {
      html = buf.toString('utf16le')
    } else {
      html = buf.toString('utf8')
    }
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }

  const num = (s) => (s == null ? null : Number(String(s).replace(/[,\s]/g, '')))
  const grab = (label) => {
    const re = new RegExp(`${label}[\\s\\S]{0,300}?([\\d,]+)`, 'i')
    const m = html.match(re)
    return m ? num(m[1]) : null
  }

  return {
    designCapacity: grab('DESIGN CAPACITY'),
    cycleCount: grab('CYCLE COUNT'),
    reportFull: grab('FULL CHARGE CAPACITY')
  }
}

function normalize(raw, design) {
  const { source, powerOnline, charging, discharging, critical, remaining, full, voltage } = raw
  let percent
  if (remaining != null && full != null && full > 0) {
    percent = Math.round((remaining / full) * 100)
  } else if (raw.percent != null) {
    percent = raw.percent
  } else {
    percent = null
  }
  if (percent != null) percent = Math.max(0, Math.min(100, percent))

  const designCapacity = design?.designCapacity ?? null
  const fullCapacity = full ?? design?.reportFull ?? null
  const health =
    designCapacity && fullCapacity && designCapacity > 0
      ? Math.round((fullCapacity / designCapacity) * 1000) / 10
      : null

  // WMI 的 ChargeRate/DischargeRate 单位是 mW
  const watts =
    charging && raw.chargeRate ? raw.chargeRate / 1000
    : discharging && raw.dischargeRate ? raw.dischargeRate / 1000
    : 0

  return {
    source,
    powerOnline: powerOnline ?? null,
    charging: !!charging,
    discharging: !!discharging,
    critical: !!critical,
    percent,
    remaining,
    fullCapacity,
    designCapacity,
    health,
    voltage: voltage ?? null,
    watts: Math.round(watts * 10) / 10,
    cycleCount: design?.cycleCount ?? null,
    updatedAt: Date.now()
  }
}

let designCache = { data: null, at: 0 }
let designPending = false
const DESIGN_TTL = 30 * 60 * 1000

// 慢通道缓存：PowerShell 读 root\WMI（mWh 容量 / 电压 / 充放电功率），
// 约 700ms 一次，只每 30 秒补一次；充电状态切换时立即强制刷新（功率符号变了）。
let detailedCache = { raw: null, at: 0 }
let detailedPending = false
const DETAILED_TTL = 30 * 1000
let lastFastKey = null

async function refreshDetailed(force = false) {
  if (detailedPending) return
  if (!force && detailedCache.raw && Date.now() - detailedCache.at < DETAILED_TTL) return
  detailedPending = true
  try {
    detailedCache = { raw: await readBatteryRaw(), at: Date.now() }
  } catch (e) {
    console.error('[battery] detailed refresh failed:', e.message)
    detailedCache.at = Date.now() // 失败也记时间，避免持续失败时每个 tick 都拉 PowerShell
  } finally {
    detailedPending = false
  }
}

// 快读（winapi）提供电量/充放电/通电状态；慢读（PowerShell）补功率、电压、容量
function mergeFast(fast, det) {
  return {
    source: det ? `${det.source}+winapi` : 'winapi',
    powerOnline: fast.powerOnline,
    charging: fast.charging,
    discharging: fast.powerOnline === false && !fast.charging,
    critical: fast.critical,
    remaining: det?.remaining ?? null,
    full: det?.full ?? null,
    voltage: det?.voltage ?? null,
    chargeRate: det?.chargeRate ?? null,
    dischargeRate: det?.dischargeRate ?? null,
    percent: fast.percent
  }
}

// powercfg /batteryreport 要跑 10 秒左右，绝不能挡住电量轮询，因此后台异步刷新
async function refreshDesign(onDone) {
  if (designPending) return
  designPending = true
  try {
    designCache = { data: await readDesignInfo(), at: Date.now() }
    if (typeof onDone === 'function') onDone(designCache.data)
  } catch (e) {
    console.error('[battery] design refresh failed:', e.message)
    designCache = { data: designCache.data, at: Date.now() }
  } finally {
    designPending = false
  }
}

async function getBattery() {
  const stale = !designCache.data || Date.now() - designCache.at > DESIGN_TTL
  if (stale) refreshDesign()

  // 快通道：koffi FFI 微秒级读电量，每个 tick 都走这里，零子进程
  const fast = readFast()
  if (fast) {
    // 首次启动先等一次完整读取，避免界面一打开功率/电压全是空
    if (!detailedCache.raw && !detailedPending) {
      await refreshDetailed(true)
    } else {
      // 充电状态或通电状态变化时，功率方向变了，立即强制补一次慢读
      const key = `${fast.powerOnline}|${fast.charging}`
      refreshDetailed(key !== lastFastKey)
      lastFastKey = key
    }
    return normalize(mergeFast(fast, detailedCache.raw), designCache.data)
  }

  // 回退：koffi 不可用时维持原有行为（每 tick 一次 PowerShell）
  const raw = await readBatteryRaw()
  return normalize(raw, designCache.data)
}

module.exports = { getBattery, refreshDesign, refreshDetailed }

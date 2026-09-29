// 高频电池轮询通道：直接用 koffi（纯 JS FFI）调 kernel32 的 GetSystemPowerStatus。
// 单次调用约 0.002ms、零子进程，替代原来每 5 秒拉起一次 PowerShell（约 700ms），
// 是托盘长驻场景下能耗优化的核心。koffi 加载失败时返回 null，由上层回退到 PowerShell。
let GetSystemPowerStatus = null

try {
  const koffi = require('koffi')
  koffi.struct('SYSTEM_POWER_STATUS', {
    ACLineStatus: 'uint8',       // 0=用电池 1=接电源 255=未知
    BatteryFlag: 'uint8',        // 1=高 2=低 4=极低 8=充电中 128=无电池 255=未知
    BatteryLifePercent: 'uint8', // 0-100，255=未知
    SystemStatusFlag: 'uint8',
    BatteryLifeTime: 'int32',    // 剩余秒数，-1=未知
    BatteryFullLifeTime: 'int32'
  })
  const kernel32 = koffi.load('kernel32.dll')
  // 注意：out 型结构体参数要用 '_Out_ T*' 原型字符串声明，传普通对象由 koffi 回写；
  // koffi 3.x 不能用 new 构造 struct 实例
  GetSystemPowerStatus = kernel32.func('GetSystemPowerStatus', 'bool', ['_Out_ SYSTEM_POWER_STATUS*'])
} catch (e) {
  console.error('[winapi] koffi 初始化失败，将回退 PowerShell 轮询:', e.message)
}

function readFast() {
  if (!GetSystemPowerStatus) return null
  try {
    const s = {}
    if (!GetSystemPowerStatus(s)) return null
    const flag = s.BatteryFlag
    if (flag & 128) return null // 无电池（台式机）
    const pct = s.BatteryLifePercent
    return {
      percent: pct >= 0 && pct <= 100 ? pct : null,
      powerOnline: s.ACLineStatus === 1 ? true : s.ACLineStatus === 0 ? false : null,
      charging: (flag & 8) !== 0,
      critical: (flag & 4) !== 0,
      secondsRemaining: s.BatteryLifeTime >= 0 ? s.BatteryLifeTime : null
    }
  } catch {
    return null
  }
}

module.exports = { readFast }

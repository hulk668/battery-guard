<template>
  <div class="app">
    <header class="top">
      <div class="title-group">
        <div class="app-mark">
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="5" width="13" height="8" rx="2.2" stroke="#8b93e0" stroke-width="1.3" />
            <rect x="15.4" y="7.6" width="1.6" height="2.8" rx="0.8" fill="#8b93e0" />
            <rect x="3" y="7" width="7" height="4" rx="1" fill="#8b93e0" />
          </svg>
        </div>
        <div>
          <h1>电池守护</h1>
          <p>充电阈值提醒 · 电池健康监控</p>
        </div>
      </div>
      <div class="pill">
        <span class="dot" :class="statusDotClass"></span>
        <span>{{ statusText }}</span>
      </div>
    </header>

    <div v-if="!apiReady" class="card empty">
      未检测到主进程接口，请在 Electron 中运行（npm run build &amp;&amp; npm start）。
    </div>

    <div v-else class="layout">
      <!-- 列 1：仪表 -->
      <section class="card gauge">
        <div class="gauge-wrap">
          <svg width="168" height="168" viewBox="0 0 168 168">
            <defs>
              <filter id="gaugeGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.4" />
              </filter>
            </defs>
            <circle cx="84" cy="84" r="65" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="11" />
            <circle
              cx="84"
              cy="84"
              r="65"
              fill="none"
              :stroke="gaugeColor"
              stroke-width="11"
              stroke-linecap="round"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="dashOffset"
              transform="rotate(-90 84 84)"
              opacity="0.4"
              filter="url(#gaugeGlow)"
            />
            <circle
              cx="84"
              cy="84"
              r="65"
              fill="none"
              :stroke="gaugeColor"
              stroke-width="11"
              stroke-linecap="round"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="dashOffset"
              transform="rotate(-90 84 84)"
            />
          </svg>
          <div class="gauge-center">
            <div>
              <span class="gauge-num">{{ bat?.percent ?? '--' }}</span>
              <span class="gauge-unit">%</span>
            </div>
            <div class="gauge-state">{{ stateLabel }}</div>
          </div>
        </div>

        <div class="gauge-meta">
          <div>
            <div class="k">{{ bat?.charging ? '充电功率' : '放电功率' }}</div>
            <div class="v">{{ bat?.watts ? bat.watts + ' W' : '—' }}</div>
          </div>
          <div>
            <div class="k">电压</div>
            <div class="v">{{ bat?.voltage ? (bat.voltage / 1000).toFixed(2) + ' V' : '—' }}</div>
          </div>
        </div>
      </section>

      <!-- 列 2：状态 + 统计 -->
      <div class="col-mid">
        <section class="card">
          <h2>电池状态</h2>
          <div class="grid">
            <div class="stat">
              <div class="k">健康度</div>
              <div class="v" :style="{ color: healthColor }">
                {{ bat?.health != null ? bat.health : '--' }}<small v-if="bat?.health != null">%</small>
              </div>
            </div>
            <div class="stat">
              <div class="k">满充容量</div>
              <div class="v">
                {{ fmtCap(bat?.fullCapacity) }}<small v-if="bat?.fullCapacity">mWh</small>
              </div>
            </div>
            <div class="stat">
              <div class="k">设计容量</div>
              <div class="v">
                {{ fmtCap(bat?.designCapacity) }}<small v-if="bat?.designCapacity">mWh</small>
              </div>
            </div>
            <div class="stat">
              <div class="k">循环次数</div>
              <div class="v">{{ bat?.cycleCount != null ? bat.cycleCount : '--' }}<small>次</small></div>
            </div>
          </div>

          <div v-if="bat?.health != null" class="health-bar">
            <div class="health-head">
              <span>容量保持率</span>
              <span>{{ bat.health }}%</span>
            </div>
            <div class="health-track">
              <div
                class="health-fill"
                :style="{ width: Math.min(100, bat.health) + '%', background: healthColor }"
              ></div>
            </div>
          </div>
        </section>

        <section class="card">
          <h2>今日统计</h2>
          <div class="grid">
            <div class="stat">
              <div class="k">高电量静置</div>
              <div class="v">{{ fmtDuration(stats?.today?.fullSoakMs) }}</div>
            </div>
            <div class="stat">
              <div class="k">插入充电次数</div>
              <div class="v">{{ stats?.today?.chargeCount ?? 0 }}<small>次</small></div>
            </div>
            <div class="stat">
              <div class="k">今日最高电量</div>
              <div class="v">
                {{ stats?.today?.peakPercent ?? '--' }}<small v-if="stats?.today?.peakPercent != null">%</small>
              </div>
            </div>
            <div class="stat">
              <div class="k">触发提醒</div>
              <div class="v">{{ stats?.today?.alerts ?? 0 }}<small>次</small></div>
            </div>
          </div>
        </section>
      </div>

      <!-- 列 3：阈值设置 -->
      <section class="card">
        <h2>阈值设置</h2>

        <div class="setting">
          <div class="setting-head">
            <span>充电上限 · 达到提醒拔电</span>
            <b>{{ cfg.upperLimit }}%</b>
          </div>
          <input
            type="range"
            min="50"
            max="100"
            step="1"
            v-model.number="cfg.upperLimit"
            @change="pushConfig"
          />
        </div>

        <div class="setting">
          <div class="setting-head">
            <span>电量下限 · 低于提醒充电</span>
            <b>{{ cfg.lowerLimit }}%</b>
          </div>
          <input
            type="range"
            min="5"
            max="60"
            step="1"
            v-model.number="cfg.lowerLimit"
            @change="pushConfig"
          />
        </div>

        <div class="switch-grid">
          <div class="row">
            <div>
              <div class="label">上限提醒</div>
              <div class="desc">充至 {{ cfg.upperLimit }}% 通知</div>
            </div>
            <button class="switch" :class="{ on: cfg.upperEnabled }" @click="toggle('upperEnabled')"></button>
          </div>
          <div class="row">
            <div>
              <div class="label">下限提醒</div>
              <div class="desc">低于 {{ cfg.lowerLimit }}% 通知</div>
            </div>
            <button class="switch" :class="{ on: cfg.lowerEnabled }" @click="toggle('lowerEnabled')"></button>
          </div>
          <div class="row">
            <div>
              <div class="label">系统通知</div>
              <div class="desc">关则仅应用内提示</div>
            </div>
            <button class="switch" :class="{ on: cfg.notifyEnabled }" @click="toggle('notifyEnabled')"></button>
          </div>
          <div class="row">
            <div>
              <div class="label">开机自启</div>
              <div class="desc">随系统后台守护</div>
            </div>
            <button class="switch" :class="{ on: cfg.autoLaunch }" @click="toggle('autoLaunch')"></button>
          </div>
          <div class="row">
            <div>
              <div class="label">最小化托盘</div>
              <div class="desc">关窗后继续监控</div>
            </div>
            <button class="switch" :class="{ on: cfg.minimizeToTray }" @click="toggle('minimizeToTray')"></button>
          </div>
          <div class="row wide">
            <div>
              <div class="label">通知通道</div>
              <div class="desc">弹不出来就换一个再试</div>
            </div>
            <select v-model="cfg.notifyChannel" @change="pushConfig">
              <option value="powershell">PowerShell（最稳）</option>
              <option value="own">电池守护</option>
              <option value="electron">应用原生</option>
            </select>
          </div>
        </div>

        <div class="btn-row">
          <button class="btn primary" @click="testAlert">测试提醒</button>
          <button class="btn" @click="openReport">电池报告</button>
          <button class="btn ghost" @click="quit">退出</button>
        </div>
      </section>
    </div>

    <div class="footnote">
      <span class="footnote-mark"></span>
      <span>
        通用电池监控：实时追踪电量、充放电功率与容量衰减。真正加速老化的不是偶尔充满，而是<b>长期插着电停在 95% 以上</b>——上方会持续统计这段时间。
      </span>
    </div>

    <div v-if="toast" class="toast">
      <b>{{ toast.title }}</b>
      <div class="sub">{{ toast.body }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'

const api = typeof window !== 'undefined' ? window.batteryAPI : null
const apiReady = !!api

const bat = ref(null)
const stats = ref(null)
const toast = ref(null)
const cfg = reactive({
  upperLimit: 80,
  lowerLimit: 30,
  upperEnabled: true,
  lowerEnabled: true,
  notifyEnabled: true,
  notifyChannel: 'powershell',
  autoLaunch: false,
  minimizeToTray: true
})

const channelLabel = computed(
  () =>
    ({
      powershell: '系统 Toast（PowerShell）',
      own: '系统 Toast（电池守护）',
      electron: '应用原生通知'
    })[cfg.notifyChannel] || cfg.notifyChannel
)

const R = 65
const circumference = 2 * Math.PI * R

const dashOffset = computed(() => {
  const p = bat.value?.percent ?? 0
  return circumference * (1 - p / 100)
})

const gaugeColor = computed(() => {
  if (!bat.value || bat.value.percent == null) return '#6b6f79'
  if (bat.value.charging) return '#0a84ff'
  if (bat.value.percent < 20) return '#ff453a'
  if (bat.value.percent < 50) return '#ff9f0a'
  return '#30d158'
})

const healthColor = computed(() => {
  const h = bat.value?.health
  if (h == null) return '#edeef0'
  if (h >= 80) return '#30d158'
  if (h >= 60) return '#ff9f0a'
  return '#ff453a'
})

const stateLabel = computed(() => {
  if (!bat.value) return '读取中…'
  if (bat.value.critical) return '电量严重不足'
  if (bat.value.charging) return '正在充电'
  if (bat.value.powerOnline) return '已接通电源'
  if (bat.value.discharging) return '使用电池'
  return '待机'
})

const statusText = computed(() => {
  if (!bat.value) return '初始化'
  const p = bat.value.percent
  return `${p != null ? p + '% · ' : ''}${stateLabel.value}`
})

const statusDotClass = computed(() => {
  if (!bat.value) return ''
  if (bat.value.critical) return 'warn'
  if (bat.value.charging) return 'charging'
  return 'on'
})

function fmtCap(v) {
  if (v == null) return '--'
  return Number(v).toLocaleString('en-US')
}

function fmtDuration(ms) {
  if (!ms) return '0 分'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} 分`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

let toastTimer = null
function showToast(t) {
  toast.value = t
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 6000)
}

async function pushConfig() {
  if (!api) return
  const next = await api.setConfig({ ...cfg })
  Object.assign(cfg, next)
}

async function toggle(key) {
  cfg[key] = !cfg[key]
  await pushConfig()
}

async function refreshStats() {
  if (!api) return
  stats.value = await api.getStats()
}

async function openReport() {
  if (!api?.openReport) return
  const r = await api.openReport()
  if (r?.ok) showToast({ title: '已生成', body: '系统电池报告已在浏览器中打开' })
  else showToast({ title: '生成失败', body: r?.error || 'powercfg 执行出错' })
}

async function testAlert() {
  if (!api?.testAlert) return
  const r = await api.testAlert()
  if (r?.ok) {
    showToast({
      title: '系统通知已发出',
      body: `通道：${channelLabel.value}。没看到就换上面的通道再试。`
    })
  } else {
    showToast({
      title: '系统通知没弹出来',
      body: `原因：${r?.detail || r?.error || r?.reason || '未知'}，检查 Windows 通知设置`
    })
  }
}

function quit() {
  if (api) api.quit()
}

let offUpdate = null
let offAlert = null

onMounted(async () => {
  if (!api) return
  const c = await api.getConfig()
  Object.assign(cfg, c)
  bat.value = await api.getBattery()
  await refreshStats()

  offUpdate = api.onUpdate((d) => { bat.value = d })
  offAlert = api.onAlert((a) => {
    showToast(a)
    refreshStats()
  })
})

onBeforeUnmount(() => {
  if (offUpdate) offUpdate()
  if (offAlert) offAlert()
  clearTimeout(toastTimer)
})
</script>

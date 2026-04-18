// ══════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════
const SUPABASE_URL    = 'https://dvjogiuycggkowmsnfmz.supabase.co';
const SUPABASE_KEY    = 'sb_publishable_xU1lmBoXs91ptXFB48U74Q_KnOSlgft';
const EMAILJS_SERVICE  = 'service_2e9dusl';
const EMAILJS_TEMPLATE = 'template_saqa72y';
const EMAILJS_PUBLIC   = 'CYdJxx9cWYeHLTDEC';

// ══════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════
let currentUser    = null;
let sensorData     = [];       // Datos del rango filtrado / últimos 500
let allData        = [];       // Cache completo local
let realtimeSocket = null;     // WebSocket Supabase Realtime
let activeFilter   = null;     // { date, from, to } | null
let emailjsReady   = false;
let renderTimer = null;
// ══════════════════════════════════════════
//  UTILIDADES SUPABASE REST
// ══════════════════════════════════════════
async function supabaseFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ══════════════════════════════════════════
//  AUTENTICACIÓN
// ══════════════════════════════════════════
async function login() {
  const email  = document.getElementById('login-email').value.trim();
  const pass   = document.getElementById('login-pass').value;
  const errEl  = document.getElementById('login-error');
  const btnEl  = document.getElementById('btn-login');
  errEl.textContent = '';

  if (!email || !pass) { errEl.textContent = 'Completa todos los campos.'; return; }

  btnEl.disabled     = true;
  btnEl.textContent  = 'Verificando...';

  try {
    const data = await supabaseFetch(
      `usuarios?email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(pass)}&select=id,email`
    );
    if (!data || !data.length) {
      errEl.textContent = 'Correo o contraseña incorrectos.';
      return;
    }
    currentUser = data[0];
    sessionStorage.setItem('iot-user', JSON.stringify(currentUser));
    mostrarDashboard();
  } catch (e) {
    errEl.textContent = 'Error de conexión: ' + e.message;
  } finally {
    btnEl.disabled    = false;
    btnEl.textContent = 'Entrar al Dashboard';
  }
}

async function register() {
  const email  = document.getElementById('reg-email').value.trim();
  const pass   = document.getElementById('reg-pass').value;
  const pass2  = document.getElementById('reg-pass2').value;
  const errEl  = document.getElementById('reg-error');
  const okEl   = document.getElementById('reg-ok');
  errEl.textContent = ''; okEl.textContent = '';

  if (!email || !pass || !pass2) { errEl.textContent = 'Completa todos los campos.'; return; }
  if (pass !== pass2)             { errEl.textContent = 'Las contraseñas no coinciden.'; return; }
  if (pass.length < 6)            { errEl.textContent = 'Mínimo 6 caracteres.'; return; }

  try {
    await supabaseFetch('usuarios', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ email, password: pass })
    });
    okEl.textContent = '✅ Cuenta creada. Ya puedes iniciar sesión.';
    switchTab('login');
  } catch (e) {
    errEl.textContent = e.message.includes('duplicate')
      ? 'Este correo ya está registrado.'
      : 'Error: ' + e.message;
  }
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem('iot-user');
  detenerPollingLed();
  desconectarRealtime();
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

// ══════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0) === (tab === 'login'));
  });
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

function showSection(name, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'reports') renderReportPreview();
}

function mostrarDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('user-email-sidebar').textContent = currentUser.email;

  // Fecha de hoy por defecto en el filtro
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('filter-date').value = hoy;

  fetchData();
  conectarRealtime();
  iniciarPollingLed();
}

// ══════════════════════════════════════════
//  FILTRO FECHA / HORA
// ══════════════════════════════════════════
function applyFilter() {
  const date = document.getElementById('filter-date').value;
  const from = document.getElementById('filter-from').value;
  const to   = document.getElementById('filter-to').value;

  if (!date) {
    document.getElementById('filter-info').textContent = '⚠️ Selecciona una fecha.';
    return;
  }

  activeFilter = { date, from, to };
  fetchData();
}

function clearFilter() {
  activeFilter = null;
  document.getElementById('filter-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('filter-from').value = '00:00';
  document.getElementById('filter-to').value   = '23:59';
  document.getElementById('filter-info').textContent = '';
  fetchData();
}

function buildQueryParams() {
  if (activeFilter) {
    const { date, from, to } = activeFilter;
    const fromISO = `${date}T${from}:00`;
    const toISO   = `${date}T${to}:59`;
    return `sensores?select=id,valor_ldr,created_at&created_at=gte.${fromISO}&created_at=lte.${toISO}&order=created_at.desc&limit=1000`;
  }
  return 'sensores?select=id,valor_ldr,created_at&order=created_at.desc&limit=500';
}

// ══════════════════════════════════════════
//  FETCH DATOS
// ══════════════════════════════════════════
async function fetchData() {
  try {
    const data = await supabaseFetch(buildQueryParams());
    sensorData = data || [];
    actualizarUI();
    renderChart();

    if (activeFilter) {
      const { date, from, to } = activeFilter;
      document.getElementById('filter-info').textContent =
        `📅 Mostrando ${sensorData.length} lecturas del ${date} entre ${from} y ${to}`;
    }
  } catch (e) {
    setStatus('disconnected', 'Error de conexión');
    console.error(e);
  }
}

// ══════════════════════════════════════════
//  SUPABASE REALTIME (WebSocket)
//  Recibe cada INSERT nuevo al instante
// ══════════════════════════════════════════
function conectarRealtime() {
  desconectarRealtime();

  // Supabase Realtime endpoint
  const wsUrl = SUPABASE_URL.replace('https://', 'wss://') + '/realtime/v1/websocket'
    + `?apikey=${SUPABASE_KEY}&vsn=1.0.0`;

  try {
    realtimeSocket = new WebSocket(wsUrl);

   realtimeSocket.onopen = () => {
  // 1. Unirse al canal
  realtimeSocket.send(JSON.stringify({
    topic: 'realtime:public:sensores',
    event: 'phx_join',
    payload: {},
    ref: '1'
  }));

  // 2. SUSCRIBIRSE A LOS CAMBIOS
  realtimeSocket.send(JSON.stringify({
    topic: 'realtime:public:sensores',
    event: 'postgres_changes',
    payload: {
      event: 'INSERT',
      schema: 'public',
      table: 'sensores'
    },
    ref: '2'
  }));

  setStatus('connected', 'En vivo');
};
                                                                                                             
realtimeSocket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  // Heartbeat
  if (msg.event === 'phx_reply' && msg.ref === '1') return;
  if (msg.event === 'heartbeat') {
    realtimeSocket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '0' }));
    return;
  }

  // Nuevo dato INSERT
  if (msg.event === 'INSERT' && msg.payload?.record) {
    const nuevo = msg.payload.record;

    if (!activeFilter) {
      sensorData.unshift(nuevo);
      if (sensorData.length > 500) sensorData.pop();
      actualizarUI(); // LEDs y cards se actualizan de inmediato

      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => renderChart(), 300); // gráfica con debounce

    } else {
      const ts = new Date(nuevo.created_at);
      const { date, from, to } = activeFilter;
      const [fH, fM] = from.split(':').map(Number);
      const [tH, tM] = to.split(':').map(Number);
      const fechaStr = ts.toISOString().split('T')[0];
      const minsDia  = ts.getHours() * 60 + ts.getMinutes();
      const minsFrom = fH * 60 + fM;
      const minsTo   = tH * 60 + tM;

      if (fechaStr === date && minsDia >= minsFrom && minsDia <= minsTo) {
        sensorData.unshift(nuevo);
        actualizarUI();

        clearTimeout(renderTimer);
        renderTimer = setTimeout(() => renderChart(), 300);
      }
    }
  }
};

    realtimeSocket.onerror = () => setStatus('disconnected', 'Sin conexión');
    realtimeSocket.onclose = () => {
      setStatus('no-data', 'Reconectando...');
      // Reconectar en 5s
      setTimeout(() => { if (currentUser) conectarRealtime(); }, 5000);
    };

  } catch (e) {
    console.error('Realtime error:', e);
  }
}

function desconectarRealtime() {
  if (realtimeSocket) {
    realtimeSocket.onclose = null; // Evitar reconexión al hacer logout
    realtimeSocket.close();
    realtimeSocket = null;
  }
}

// ══════════════════════════════════════════
//  ACTUALIZAR CARDS + LEDs
// ══════════════════════════════════════════
function actualizarUI() {
  if (!sensorData.length) {
    setStatus('no-data', activeFilter ? 'Sin datos en ese rango' : 'Sin datos');
    ['ultimo-valor','nivel-luz','ultima-lectura'].forEach(id =>
      document.getElementById(id).textContent = '—'
    );
    document.getElementById('total-lecturas').textContent = '0';
    resetLEDs();
    return;
  }

  const ultimo = sensorData[0];
  const val    = ultimo.valor_ldr;
  const fecha  = new Date(ultimo.created_at);

  document.getElementById('ultimo-valor').textContent   = val;
  document.getElementById('total-lecturas').textContent = sensorData.length;
  document.getElementById('ultima-lectura').textContent = fecha.toLocaleTimeString('es-CO');

  if (val < 1000) {
    document.getElementById('nivel-luz').textContent = '🔴 Bajo';
    activarLED('rojo');
  } else if (val < 2500) {
    document.getElementById('nivel-luz').textContent = '🟡 Medio';
    activarLED('amarillo');
  } else {
    document.getElementById('nivel-luz').textContent = '🟢 Alto';
    activarLED('verde');
  }

  if (!activeFilter) setStatus('connected', 'En vivo');
}

function setStatus(type, text) {
  document.querySelector('.dot').className = `dot ${type}`;
  document.getElementById('status-text').textContent = text;
}

function resetLEDs() {
  ['rojo','amarillo','verde'].forEach(c => {
    document.getElementById(`led-${c}`).className = 'led-item';
  });
}

function activarLED(color) {
  resetLEDs();
  document.getElementById(`led-${color}`).className = `led-item active ${color}`;
}

// ══════════════════════════════════════════
//  GRÁFICAS (Plotly.js)
// ══════════════════════════════════════════
const PLOTLY_BASE = {
  paper_bgcolor: 'transparent',
  plot_bgcolor:  'transparent',
  font:  { color: '#94a3b8', family: 'Segoe UI, system-ui' },
  xaxis: { gridcolor: '#1e3a5f', color: '#64748b', automargin: true },
  yaxis: { gridcolor: '#1e3a5f', color: '#64748b', automargin: true },
  margin:     { t: 20, l: 55, r: 20, b: 55 },
  showlegend: true,
  legend:     { font: { color: '#94a3b8' } }
};
const PLOTLY_CFG = { responsive: true, displayModeBar: false };

function renderChart(containerId = 'plotly-chart', type = null) {
  if (!sensorData.length) return;
  type = type || document.getElementById('chart-type')?.value || 'linea';
  const sorted = [...sensorData].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  switch (type) {
    case 'linea':      renderLinea(containerId, sorted);      break;
    case 'niveles':    renderNiveles(containerId, sorted);    break;
    case 'promedio':   renderPromedio(containerId, sorted);   break;
    case 'histograma': renderHistograma(containerId, sorted); break;
  }
}

function renderLinea(id, data) {
  Plotly.react(id, [{
    x: data.map(d => new Date(d.created_at)),
    y: data.map(d => d.valor_ldr),
    type: 'scatter', mode: 'lines+markers', name: 'LDR',
    line:   { color: '#0ea5e9', width: 2 },
    marker: { color: '#38bdf8', size: 4 }
  }], {
    ...PLOTLY_BASE,
    xaxis: { ...PLOTLY_BASE.xaxis, title: 'Tiempo' },
    yaxis: { ...PLOTLY_BASE.yaxis, title: 'Valor LDR', range: [0, 4095] }
  }, PLOTLY_CFG);
}

function renderNiveles(id, data) {
  const bajo  = data.filter(d => d.valor_ldr < 1000).length;
  const medio = data.filter(d => d.valor_ldr >= 1000 && d.valor_ldr < 2500).length;
  const alto  = data.filter(d => d.valor_ldr >= 2500).length;

  Plotly.react(id, [{
    x: ['🔴 Bajo (0-1000)', '🟡 Medio (1000-2500)', '🟢 Alto (2500-4095)'],
    y: [bajo, medio, alto],
    type: 'bar', name: 'Lecturas por nivel',
    marker: { color: ['#ef4444', '#f59e0b', '#10b981'] }
  }], {
    ...PLOTLY_BASE,
    yaxis: { ...PLOTLY_BASE.yaxis, title: 'Cantidad de lecturas' }
  }, PLOTLY_CFG);
}

function renderPromedio(id, data) {
  const byHour = {};
  data.forEach(d => {
    const h = new Date(d.created_at);
    const key = `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')} ${String(h.getHours()).padStart(2,'0')}:00`;
    if (!byHour[key]) byHour[key] = [];
    byHour[key].push(d.valor_ldr);
  });
  const labels = Object.keys(byHour).sort();
  const vals   = labels.map(k => Math.round(byHour[k].reduce((a,b) => a+b, 0) / byHour[k].length));

  Plotly.react(id, [{
    x: labels, y: vals, type: 'scatter', mode: 'lines+markers',
    fill: 'tozeroy', name: 'Promedio por hora',
    line: { color: '#a78bfa', width: 2 }, marker: { color: '#c4b5fd', size: 6 },
    fillcolor: 'rgba(167,139,250,0.15)'
  }], {
    ...PLOTLY_BASE,
    xaxis: { ...PLOTLY_BASE.xaxis, title: 'Hora' },
    yaxis: { ...PLOTLY_BASE.yaxis, title: 'Promedio LDR', range: [0, 4095] }
  }, PLOTLY_CFG);
}

function renderHistograma(id, data) {
  Plotly.react(id, [{
    x: data.map(d => d.valor_ldr), type: 'histogram',
    nbinsx: 20, name: 'Distribución',
    marker: { color: '#06b6d4', opacity: 0.8 }
  }], {
    ...PLOTLY_BASE,
    xaxis: { ...PLOTLY_BASE.xaxis, title: 'Valor LDR', range: [0, 4095] },
    yaxis: { ...PLOTLY_BASE.yaxis, title: 'Frecuencia' }
  }, PLOTLY_CFG);
}

// ══════════════════════════════════════════
//  INFORME — VISTA PREVIA
// ══════════════════════════════════════════
function renderReportPreview() {
  if (!sensorData.length) return;
  const type = document.getElementById('report-chart-type')?.value || 'linea';
  renderChart('report-chart-preview', type);
}

// ══════════════════════════════════════════
//  ENVÍO DE INFORME — EmailJS
//  El correo llega al destinatario ingresado,
//  NO a tu cuenta. Requiere configurar el
//  template con {{to_email}} en el campo "To"
// ══════════════════════════════════════════
async function cargarEmailJS() {
  if (emailjsReady) return;
  await new Promise((res, rej) => {
    const s  = document.createElement('script');
    s.src    = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  emailjs.init(EMAILJS_PUBLIC);
  emailjsReady = true;
}

async function enviarInforme() {
  const emailDest = document.getElementById('report-email').value.trim();
  const mensaje   = document.getElementById('report-msg').value.trim();
  const statusEl  = document.getElementById('report-status');
  const btnEl     = document.getElementById('btn-send-report');
  statusEl.textContent = '';
  statusEl.style.color = 'var(--success)';

  if (!emailDest) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '⚠️ Ingresa un correo destino.';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDest)) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '⚠️ El correo no tiene un formato válido.';
    return;
  }
  if (!sensorData.length) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '⚠️ No hay datos para enviar.';
    return;
  }

  btnEl.disabled    = true;
  btnEl.textContent = '⏳ Generando informe...';
  statusEl.textContent = 'Preparando imagen de la gráfica...';

  try {
    // 1. Renderizar preview con el tipo seleccionado
    renderReportPreview();
    await new Promise(r => setTimeout(r, 500)); // Esperar a que Plotly renderice

    // 2. Capturar gráfica como PNG base64
    let chartImg = '';
    try {
      chartImg = await Plotly.toImage(
        document.getElementById('report-chart-preview'),
        { format: 'png', width: 800, height: 400 }
      );
    } catch (_) { chartImg = ''; }

    // 3. Construir resumen de datos
    const ultimo = sensorData[0];
    const fecha  = new Date(ultimo.created_at).toLocaleString('es-CO');
    const nivel  = ultimo.valor_ldr < 1000 ? 'Bajo 🔴' : ultimo.valor_ldr < 2500 ? 'Medio 🟡' : 'Alto 🟢';
    const vals   = sensorData.map(d => d.valor_ldr);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const avgVal = Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
    const bajo   = vals.filter(v => v < 1000).length;
    const medio  = vals.filter(v => v >= 1000 && v < 2500).length;
    const alto   = vals.filter(v => v >= 2500).length;

    const rangoInfo = activeFilter
      ? `Fecha: ${activeFilter.date} | Desde ${activeFilter.from} hasta ${activeFilter.to}`
      : 'Últimas lecturas en tiempo real';

    // 4. Cargar EmailJS
    statusEl.textContent = 'Conectando con el servicio de correo...';
    await cargarEmailJS();

    // 5. Enviar — IMPORTANTE: to_email debe ser variable en tu template de EmailJS
    statusEl.textContent = 'Enviando correo...';
    await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
      to_email:      emailDest,          // ← El destinatario real
      from_name:     'IoT LDR Dashboard',
      subject:       `Informe IoT LDR - ${fecha}`,
      ultimo_valor:  ultimo.valor_ldr,
      nivel_luz:     nivel,
      fecha:         fecha,
      rango:         rangoInfo,
      total:         sensorData.length,
      min_val:       minVal,
      max_val:       maxVal,
      avg_val:       avgVal,
      cnt_bajo:      bajo,
      cnt_medio:     medio,
      cnt_alto:      alto,
      mensaje:       mensaje || 'Informe automático del sistema IoT LDR.',
      chart_image:   chartImg,           // Imagen base64 de la gráfica
      user_email:    currentUser?.email || ''
    });

    statusEl.style.color = 'var(--success)';
    statusEl.textContent  = `✅ Informe enviado correctamente a ${emailDest}`;
  } catch (e) {
    statusEl.style.color = 'var(--danger)';
    const errMsg = e?.text || e?.message || JSON.stringify(e);
    // Error más común: template mal configurado
    if (errMsg.includes('412') || errMsg.includes('template')) {
      statusEl.textContent = `❌ Error en el template de EmailJS. Asegúrate que el campo "To" sea {{to_email}}. Detalle: ${errMsg}`;
    } else {
      statusEl.textContent = `❌ Error al enviar: ${errMsg}`;
    }
    console.error('EmailJS error:', e);
  } finally {
    btnEl.disabled    = false;
    btnEl.textContent = '📧 Enviar Informe por Correo';
  }
}

// ══════════════════════════════════════════
//  LED INTEGRADO (GPIO 2)
//  Lee y escribe en tabla led_control de Supabase.
//  El ESP32 consulta la misma tabla cada 3s
//  y enciende/apaga su pin 2 según el valor.
// ══════════════════════════════════════════
let builtinLedState  = null;   // true = encendido | false = apagado
let ledPollInterval  = null;

async function fetchBuiltinLedState() {
  try {
    const data = await supabaseFetch('led_control?id=eq.1&select=estado');
    if (data && data.length) {
      const nuevo = data[0].estado;
      if (nuevo !== builtinLedState) {
        builtinLedState = nuevo;
        actualizarBotonLed(builtinLedState);
      }
    }
  } catch (e) {
    console.warn('Error leyendo estado LED integrado:', e);
  }
}

async function toggleBuiltinLed() {
  const btn = document.getElementById('btn-builtin-led');
  btn.disabled = true;

  const nuevoEstado = !builtinLedState;

  try {
    await supabaseFetch('led_control?id=eq.1', {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    builtinLedState = nuevoEstado;
    actualizarBotonLed(builtinLedState);
  } catch (e) {
    console.error('Error al cambiar estado LED integrado:', e);
  } finally {
    btn.disabled = false;
  }
}

function actualizarBotonLed(encendido) {
  const btn        = document.getElementById('btn-builtin-led');
  const indicator  = document.getElementById('builtin-indicator');
  const statusTxt  = document.getElementById('builtin-status-text');

  btn.disabled = false;

  if (encendido) {
    btn.textContent = '🔴 Apagar LED';
    btn.className   = 'btn-led-toggle state-on';
    indicator.classList.add('led-on');
    statusTxt.textContent = 'Encendido';
  } else {
    btn.textContent = '🟢 Encender LED';
    btn.className   = 'btn-led-toggle state-off';
    indicator.classList.remove('led-on');
    statusTxt.textContent = 'Apagado';
  }
}

function iniciarPollingLed() {
  fetchBuiltinLedState();                             // lectura inmediata al entrar
  ledPollInterval = setInterval(fetchBuiltinLedState, 1000);
}

function detenerPollingLed() {
  if (ledPollInterval) {
    clearInterval(ledPollInterval);
    ledPollInterval = null;
  }
}

// ══════════════════════════════════════════
//  INICIO
// ══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  const stored = sessionStorage.getItem('iot-user');
  if (stored) {
    currentUser = JSON.parse(stored);
    mostrarDashboard();
  }
});

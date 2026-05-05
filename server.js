// ══════════════════════════════════════════
//  SERVIDOR EXPRESS — Monitor LDR IoT
//
//  PASOS PARA EJECUTAR:
//  1. npm install
//  2. node server.js
//  3. Abrir http://localhost:3000
//
//  ENDPOINTS DISPONIBLES:
//  GET  /sensor          → últimas 100 lecturas
//  GET  /sensor/:valor   → lecturas con ese valor (ej: /sensor/0)
//  POST /sensor          → insertar lectura { valor_ldr: número }
//  GET  /led             → estado actual LED integrado
//  GET  /led/1/on        → ENCENDER LED integrado
//  GET  /led/0/off       → APAGAR LED integrado
// ══════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = 3000;

// ── Configuración Supabase ──────────────────
const SUPABASE_URL = 'https://dvjogiuycggkowmsnfmz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xU1lmBoXs91ptXFB48U74Q_KnOSlgft';

const SUPABASE_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json'
};

// ── Middleware ──────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));  // Sirve index.html, styles.css, app.js

// ── Helper Supabase ─────────────────────────
async function supabase(endpoint, options = {}) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: { ...SUPABASE_HEADERS, ...(options.headers || {}) }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : null;
}

// ══════════════════════════════════════════
//  PÁGINA DE BIENVENIDA / DOCUMENTACIÓN
// ══════════════════════════════════════════
app.get('/api', (req, res) => {
  res.json({
    proyecto:  'Monitor LDR — Universidad Simón Bolívar',
    version:   '1.0.0',
    endpoints: {
      'GET  /sensor':          'Últimas 100 lecturas del sensor',
      'GET  /sensor/:valor':   'Lecturas con valor exacto (ej: /sensor/0 → sin luz)',
      'POST /sensor':          'Insertar lectura manual { "valor_ldr": 1234 }',
      'GET  /led':             'Estado actual del LED integrado (GPIO 2)',
      'GET  /led/1/on':        'ENCENDER el LED integrado',
      'GET  /led/0/off':       'APAGAR el LED integrado'
    }
  });
});

// ══════════════════════════════════════════
//  RUTAS SENSOR
// ══════════════════════════════════════════

// GET /sensor — últimas 100 lecturas
app.get('/sensor', async (req, res) => {
  try {
    const data = await supabase(
      'sensores?select=id,valor_ldr,created_at&order=created_at.desc&limit=100'
    );
    res.json({ ok: true, total: data.length, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /sensor/:valor — filtra lecturas por valor exacto
// Ejemplo: /sensor/0   → lecturas con valor_ldr = 0 (oscuridad total)
// Ejemplo: /sensor/500 → lecturas con valor_ldr = 500
app.get('/sensor/:valor', async (req, res) => {
  const valor = parseInt(req.params.valor);
  if (isNaN(valor)) {
    return res.status(400).json({ ok: false, error: 'El valor debe ser un número entero' });
  }
  try {
    const data = await supabase(
      `sensores?select=id,valor_ldr,created_at&valor_ldr=eq.${valor}&order=created_at.desc&limit=100`
    );
    const nivel = valor < 1000 ? 'Bajo 🔴' : valor < 2500 ? 'Medio 🟡' : 'Alto 🟢';
    res.json({ ok: true, valor_filtrado: valor, nivel, total: data.length, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /sensor — insertar nueva lectura manualmente
// Body JSON: { "valor_ldr": 1234 }
app.post('/sensor', async (req, res) => {
  const { valor_ldr } = req.body;
  if (valor_ldr === undefined || isNaN(Number(valor_ldr))) {
    return res.status(400).json({ ok: false, error: 'Falta campo valor_ldr numérico en el body' });
  }
  const val = Number(valor_ldr);
  if (val < 0 || val > 4095) {
    return res.status(400).json({ ok: false, error: 'valor_ldr debe estar entre 0 y 4095' });
  }
  try {
    await supabase('sensores', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ valor_ldr: val })
    });
    res.json({ ok: true, mensaje: `✅ Lectura ${val} insertada correctamente` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════
//  RUTAS LED INTEGRADO (GPIO 2)
// ══════════════════════════════════════════

// GET /led — consulta el estado actual del LED
app.get('/led', async (req, res) => {
  try {
    const data   = await supabase('led_control?id=eq.1&select=estado');
    const estado = data?.[0]?.estado ?? false;
    res.json({
      ok:          true,
      estado,
      descripcion: estado ? '💡 LED encendido (GPIO 2 HIGH)' : '🔌 LED apagado (GPIO 2 LOW)'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /led/1/on  → ENCIENDE el LED integrado
// GET /led/0/off → APAGA el LED integrado
app.get('/led/:valor/:accion', async (req, res) => {
  const { valor, accion } = req.params;

  let nuevoEstado;
  if      (valor === '1' || accion === 'on')  nuevoEstado = true;
  else if (valor === '0' || accion === 'off') nuevoEstado = false;
  else {
    return res.status(400).json({
      ok:    false,
      error: 'Ruta inválida. Usa /led/1/on para encender o /led/0/off para apagar'
    });
  }

  try {
    await supabase('led_control?id=eq.1', {
      method:  'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ estado: nuevoEstado })
    });
    res.json({
      ok:          true,
      estado:      nuevoEstado,
      descripcion: nuevoEstado
        ? '💡 LED integrado ENCENDIDO — ESP32 GPIO 2 HIGH'
        : '🔌 LED integrado APAGADO  — ESP32 GPIO 2 LOW'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Inicio del servidor ─────────────────────
app.listen(PORT, () => {
  console.log('\n✅  Servidor Monitor LDR corriendo');
  console.log('════════════════════════════════════════');
  console.log(`  Dashboard :       http://localhost:${PORT}`);
  console.log(`  API docs  :       http://localhost:${PORT}/api`);
  console.log('────────────────────────────────────────');
  console.log(`  Sensor (todas):   http://localhost:${PORT}/sensor`);
  console.log(`  Sensor valor 0:   http://localhost:${PORT}/sensor/0`);
  console.log(`  LED estado:       http://localhost:${PORT}/led`);
  console.log(`  Encender LED:     http://localhost:${PORT}/led/1/on`);
  console.log(`  Apagar LED:       http://localhost:${PORT}/led/0/off`);
  console.log('════════════════════════════════════════\n');
});

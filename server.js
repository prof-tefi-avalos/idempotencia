// ============================================================================
// DEMO MUY SENCILLA DE IDEMPOTENCIA (estilo Redis) — CERO DEPENDENCIAS
// ----------------------------------------------------------------------------
// No usa Express ni Redis: solo el módulo "http" que ya viene con Node.
// Así el único requisito para correrla es tener Node instalado — nada de
// "npm install", nada de Docker, nada de instalar Redis.
//
// La idea: un endpoint POST /pedidos "crea un pedido" (simulamos la base de
// datos con un array en memoria). Si el mismo cliente reintenta la MISMA
// operación (misma Idempotency-Key) — por ejemplo porque se cortó la red y
// no vio la respuesta — el servidor NO vuelve a crear el pedido: le devuelve
// la respuesta que ya había guardado la primera vez.
//
// Si cambia la Idempotency-Key, se trata como una operación distinta y sí
// crea un pedido nuevo.
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const createFakeRedisClient = require('./fakeRedisClient');

const PORT = 3000;
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24; // 24hs: cuánto tiempo guardamos cada key

// --- "Redis" ----------------------------------------------------------------
// Un Redis de juguete en memoria (fakeRedisClient.js), con la MISMA API que
// el cliente real de Redis (set con NX/EX, get). El middleware de abajo es
// idéntico al que usarías en producción con Redis de verdad. Ver el
// comentario en fakeRedisClient.js para el cambio de una línea que hace
// falta para pasar a Redis real.
const redisClient = createFakeRedisClient();

// --- "Base de datos" en memoria, solo para ver el efecto en la demo --------
const pedidos = [];

// ============================================================================
// LÓGICA DE IDEMPOTENCIA (esto es lo importante de la demo)
// ============================================================================
// Devuelve:
//   { ok: true }                                   → seguí adelante, procesá normal
//   { ok: false, statusCode, body }                 → cortá acá, respondé esto
//   { ok: 'proceed', redisKey }                      → seguí, y guardá el resultado en redisKey al terminar
async function chequearIdempotencia(idempotencyKey) {
  if (!idempotencyKey) {
    return { ok: false, statusCode: 400, body: { data: null, error: { message: 'Falta el header Idempotency-Key' } } };
  }

  const redisKey = `idempotency:${idempotencyKey}`;

  // set(..., { NX: true }) = "guardá esto SOLO SI la key no existe todavía".
  // En Redis real esto es atómico: si dos requests llegan casi al mismo
  // tiempo con la misma key, solo una de las dos gana la carrera.
  const reserved = await redisClient.set(
    redisKey,
    JSON.stringify({ status: 'processing' }),
    { NX: true, EX: IDEMPOTENCY_TTL_SECONDS }
  );

  if (!reserved) {
    // Ya existía esta key: ya vimos este intento antes.
    const stored = JSON.parse(await redisClient.get(redisKey));

    if (stored.status === 'processing') {
      console.log(`⏳ Key "${idempotencyKey}" ya se está procesando, devuelvo 409`);
      return { ok: false, statusCode: 409, body: { data: null, error: { message: 'Esta operación ya se está procesando' } } };
    }

    console.log(`♻️  Key "${idempotencyKey}" repetida: devuelvo la respuesta guardada (no se duplica el pedido)`);
    return { ok: false, statusCode: stored.statusCode, body: stored.body };
  }

  console.log(`🆕 Key "${idempotencyKey}" nueva: proceso el pedido`);
  return { ok: true, redisKey };
}

async function guardarResultadoIdempotente(redisKey, statusCode, body) {
  await redisClient.set(
    redisKey,
    JSON.stringify({ status: 'done', statusCode, body }),
    { EX: IDEMPOTENCY_TTL_SECONDS }
  );
}

// ============================================================================
// SERVER HTTP (a mano, sin Express, para no depender de "npm install")
// ============================================================================
function leerBodyJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function responderJSON(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  // ⬇️ Agregado: sirve public/index.html — una página que usa la misma
  // Idempotency-Key que ya vimos por curl, pero generada por el navegador
  // (crypto.randomUUID()) y mandada con fetch(). No toca la lógica de
  // idempotencia de abajo, solo le da una interfaz visual.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && req.url === '/pedidos') {
    let body;
    try {
      body = await leerBodyJSON(req);
    } catch {
      return responderJSON(res, 400, { data: null, error: { message: 'JSON inválido' } });
    }

    const idempotencyKey = req.headers['idempotency-key'];
    const check = await chequearIdempotencia(idempotencyKey);

    if (!check.ok) {
      return responderJSON(res, check.statusCode, check.body);
    }

    // ⬅️ acá está el "efecto secundario" que NO queremos duplicar
    const pedido = { id: pedidos.length + 1, curso: body.curso || 'Sin especificar' };
    pedidos.push(pedido);
    console.log(`   → Pedido creado. Total de pedidos en la "DB": ${pedidos.length}`);

    const responseBody = { data: pedido, error: null };
    await guardarResultadoIdempotente(check.redisKey, 201, responseBody);
    return responderJSON(res, 201, responseBody);
  }

  if (req.method === 'GET' && req.url === '/pedidos') {
    return responderJSON(res, 200, { data: pedidos, error: null });
  }

  responderJSON(res, 404, { data: null, error: { message: 'No encontrado' } });
});

server.listen(PORT, () => {
  console.log(`✅ Server escuchando en http://localhost:${PORT}`);
  console.log('   Probalo con los comandos curl del README.md\n');
});

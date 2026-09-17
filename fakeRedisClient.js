// ============================================================================
// "REDIS" DE JUGUETE, EN MEMORIA — sin instalar nada, sin Docker.
// ----------------------------------------------------------------------------
// Implementa EXACTAMENTE la misma forma en que se usa el cliente real de
// Redis (paquete npm "redis") para las dos operaciones que necesitamos:
//
//   await client.set(key, value, { NX: true, EX: segundos })
//   await client.get(key)
//
// - NX ("not exists"): solo guarda el valor si la key todavía no existía.
//   Si ya existía, no hace nada y devuelve null (igual que Redis real).
// - EX: cuántos segundos hasta que la key expire sola.
//
// El día que quieras usar Redis de verdad (por ejemplo con `brew install
// redis` y `redis-server`), el ÚNICO cambio en server.js es reemplazar:
//
//   const redisClient = require('./fakeRedisClient')();
//
// por:
//
//   const { createClient } = require('redis');
//   const redisClient = createClient({ url: 'redis://localhost:6379' });
//   await redisClient.connect();
//
// El middleware de idempotencia (idempotencyMiddleware en server.js) no se
// toca ni una línea: le habla a "redisClient" sin saber si es el de mentira
// o el real.
// ============================================================================

function createFakeRedisClient() {
  const store = new Map(); // key -> { value, expiresAt }

  function isExpired(entry) {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  return {
    async set(key, value, options = {}) {
      const existing = store.get(key);
      const stillValid = existing && !isExpired(existing);

      if (options.NX && stillValid) {
        // Ya existía y no expiró: como Redis real, no pisamos nada.
        return null;
      }

      const expiresAt = options.EX ? Date.now() + options.EX * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },

    async get(key) {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) return null;
      return entry.value;
    },
  };
}

module.exports = createFakeRedisClient;

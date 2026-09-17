# Demo: idempotencia (estilo Redis, cero dependencias)

Demo mínima para mostrar en clase (o mandarle a un alumno) cómo se implementa
idempotencia de verdad: en el backend, con una `Idempotency-Key` — no
deshabilitando un botón en el front.

**No hace falta Docker, ni Redis, ni `npm install`.** Usa solo el módulo
`http` que ya viene con Node. `fakeRedisClient.js` es un mini "Redis" en
memoria que respeta la misma API que el cliente real
(`set(key, value, { NX, EX })` y `get(key)`), así que la lógica de
idempotencia es idéntica a la que usarías en producción con Redis de verdad —
solo cambia de dónde sale el dato.

## 1. Correr

Necesitás únicamente tener Node instalado.

```bash
node server.js
```

Vas a ver en consola:

```
✅ Server escuchando en http://localhost:3000
```

## 2. Probar la demo

Abrí otra terminal para los `curl` (dejá el server corriendo en la primera).

### Paso A — primera vez con una key nueva → crea el pedido

```bash
curl -X POST http://localhost:3000/pedidos \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: abc-123" \
  -d '{"curso":"Express.js"}'
```

Respuesta esperada (201):

```json
{"data":{"id":1,"curso":"Express.js"},"error":null}
```

En la consola del server vas a ver `🆕 Key "abc-123" nueva: proceso el pedido`
y el contador de pedidos en 1.

### Paso B — reintentar con la MISMA key → no duplica

Ejecutá exactamente el mismo comando de arriba, sin cambiar nada:

```bash
curl -X POST http://localhost:3000/pedidos \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: abc-123" \
  -d '{"curso":"Express.js"}'
```

Vas a recibir **la misma respuesta exacta** (mismo `id`), y en consola vas a ver
`♻️  Key "abc-123" repetida: devuelvo la respuesta guardada (no se duplica el pedido)`.
Repetilo las veces que quieras: el contador de pedidos NO se mueve de 1.

Este es el caso que simula a un agente de IA (o cualquier cliente) reintentando
la misma operación porque no le llegó la respuesta a tiempo.

### Paso C — usar una key DISTINTA → sí crea un pedido nuevo

```bash
curl -X POST http://localhost:3000/pedidos \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: xyz-789" \
  -d '{"curso":"Node.js"}'
```

Ahora sí se crea un segundo pedido (`id: 2`), porque para el servidor es una
operación distinta.

### Paso D — ver el estado de la "base de datos"

```bash
curl http://localhost:3000/pedidos
```

Deberías ver 2 pedidos en total (uno de la key `abc-123` y uno de `xyz-789`),
sin importar cuántas veces hayas reintentado el paso B.

### Extra — sin Idempotency-Key → 400

```bash
curl -X POST http://localhost:3000/pedidos \
  -H "Content-Type: application/json" \
  -d '{"curso":"Test"}'
```

## Qué mirar con los alumnos

- `chequearIdempotencia()` en `server.js` es el corazón de la demo: usa
  `set(key, value, { NX: true, EX: ... })`, el equivalente a
  `SET key value NX EX segundos` en Redis real — "guardá esto solo si la key
  no existe todavía". En Redis real esa operación es **atómica**, lo cual es
  clave para que dos requests casi simultáneas con la misma key no generen
  una condición de carrera.
- El `EX` (expiración) hace que la key "se borre sola" después de 24hs: no
  queremos guardar esto para siempre.
- El "efecto secundario" (`pedidos.push(...)`) está DESPUÉS de que ya
  chequeamos la key — nunca se ejecuta dos veces para la misma key.
- Esto es exactamente lo contrario a poner `disabled` en un botón del
  front: acá la garantía vive en el servidor, así que protege contra
  reintentos de red, múltiples pestañas, o un cliente que ni siquiera pasa
  por una interfaz (como un agente de IA).

## 3. Probarlo desde el navegador (front real, sin curl)

Con el server corriendo (`node server.js`), abrí:

```
http://localhost:3000/
```

Es `public/index.html`, agregado a esta demo — el server ahora también sirve
esa página en `GET /` (ver el bloque agregado al principio de `server.js`,
antes del `if` de `POST /pedidos`; el resto del archivo no se tocó).

Qué hace la página:

- Genera la `Idempotency-Key` en el **navegador**, con `crypto.randomUUID()`
  — el servidor nunca la inventa, solo la recibe.
- **① Crear pedido**: genera una key nueva y hace el POST (equivalente al Paso A por curl).
- **② Reintentar**: reusa la MISMA key del botón ① y vuelve a mandar el POST
  — es el fetch que haría un cliente real (o un agente de IA) que no está
  seguro si su request anterior llegó a procesarse. Probalo varias veces:
  siempre te va a devolver la misma respuesta, sin crear un pedido nuevo.
- **Ver todos los pedidos**: hace `GET /pedidos` para que se vea el estado
  real de la "base de datos" y se confirme que los reintentos no sumaron nada.

Esto es lo mismo que el Paso B por curl, pero mostrando el detalle que a
veces queda implícito: la key no la genera el servidor ni un middleware
mágico — la genera quien hace el request, y por eso tiene que persistir
entre el intento original y sus reintentos (por eso vive en una variable de
JS, no se regenera en cada click).

## Si más adelante querés mostrar Redis de verdad

En Mac, sin Docker, la forma más simple es con Homebrew:

```bash
brew install redis
redis-server        # lo deja corriendo en una terminal, en localhost:6379
npm install redis   # el cliente oficial de Node para Redis
```

Y en `server.js`, reemplazás esta línea:

```js
const redisClient = createFakeRedisClient();
```

por:

```js
const { createClient } = require('redis');
const redisClient = createClient({ url: 'redis://localhost:6379' });
await redisClient.connect();
```

El resto del código (toda la lógica de idempotencia) no cambia ni una línea.

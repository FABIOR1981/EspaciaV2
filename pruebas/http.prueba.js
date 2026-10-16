'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reglas = require('../compartido/reglas.json');
const c = require('../netlify/functions/nucleo/contrasenas');
const sesionModulo = require('../netlify/functions/nucleo/sesion');
const g = require('../netlify/functions/nucleo/google_calendario');
const { ConfiguracionIncompleta } = require('../netlify/functions/nucleo/configuracion');
const { crearCalendarioSimulado } = require('./ayudas/calendario_simulado');
const { crearAlmacenEnMemoria } = require('./ayudas/almacen_en_memoria');

const SECRETO = 'secreto-de-prueba-largo-0123456789abcdef0123';
const INICIO = new Date('2026-10-15T13:00:00Z'); // jueves 15/10/2026, 10:00 en Montevideo

const manejadores = {
  reglas: require('../netlify/functions/reglas'),
  ingresar: require('../netlify/functions/ingresar'),
  clave: require('../netlify/functions/clave'),
  reservas: require('../netlify/functions/reservas'),
  bloqueos: require('../netlify/functions/bloqueos'),
  usuarios: require('../netlify/functions/usuarios'),
};

async function crearEntorno(opciones = {}) {
  const hash = (clave) => c.generarHash(clave);
  const usuarios = [
    { id: 'Admin', nombre: 'Administración', rol: 'admin', consPref: [1, 2, 3, 4, 5], activo: true, requiereCambioPass: false, contrasena: await hash('ClaveAdmin1') },
    { id: 'Gestora', nombre: 'Gestora G', rol: 'gestor', consPref: [1, 2, 3, 4, 5], activo: true, requiereCambioPass: false, contrasena: await hash('ClaveGestora1') },
    { id: 'AdrianaPR', nombre: 'Adriana Perla R', rol: 'usuario', consPref: [2, 3], activo: true, requiereCambioPass: false, contrasena: await hash('ClaveAdriana1') },
    { id: 'Luis', nombre: 'Luis Pérez', rol: 'usuario', consPref: [1], activo: true, requiereCambioPass: false, contrasena: await hash('ClaveLuis1') },
    { id: 'Nuevo', nombre: 'Usuario Nuevo', rol: 'usuario', consPref: [1], activo: true, requiereCambioPass: true, contrasena: await hash('ClaveTemporal1') },
  ];
  const cal = crearCalendarioSimulado();
  const repo = g.crearRepositorioDeReservas(cal, { calendarioId: 'cal' }, { zonaHoraria: 'America/Montevideo', notificarInvitados: false });
  const almacen = crearAlmacenEnMemoria(usuarios);
  const reloj = { ahora: INICIO };
  const deps = {
    config: { modo: 'pruebas', zonaHoraria: 'America/Montevideo', sesion: { secreto: SECRETO } },
    reglas, almacen, repo,
    reloj: () => reloj.ahora,
    ...opciones,
  };
  const dependencias = async () => deps;
  const h = Object.fromEntries(Object.entries(manejadores).map(([n, m]) => [n, m.crearHandler(dependencias)]));

  async function llamar(nombre, { metodo = 'GET', params, cuerpo, token, texto, encabezados = {} } = {}) {
    const event = {
      httpMethod: metodo,
      queryStringParameters: params || null,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...encabezados },
      body: texto !== undefined ? texto : cuerpo !== undefined ? JSON.stringify(cuerpo) : null,
    };
    const r = await h[nombre](event);
    return { estado: r.statusCode, encabezados: r.headers, cuerpo: JSON.parse(r.body), crudo: r.body };
  }
  async function ingresarComo(usuario, clave) {
    const r = await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario, clave } });
    assert.equal(r.estado, 200, `no pudo ingresar ${usuario}: ${r.crudo}`);
    return r.cuerpo.token;
  }
  return { cal, repo, almacen, reloj, deps, llamar, ingresarComo, h };
}

const RESERVA = { consultorio: 2, fecha: '2026-10-19', hora: '10:00', duracion: 60 }; // lunes

// ---------- Reglas públicas y método ----------

test('GET /reglas es público y entrega la configuración compartida', async () => {
  const { llamar } = await crearEntorno();
  const r = await llamar('reglas');
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.espacios.cantidad, 5);
  assert.deepEqual(r.cuerpo.duracionesMinutos, [60, 90]);
});

test('un método no permitido responde 405 e indica cuáles sí', async () => {
  const { llamar } = await crearEntorno();
  const r = await llamar('reservas', { metodo: 'PUT' });
  assert.equal(r.estado, 405);
  assert.equal(r.encabezados.Allow, 'GET, POST, DELETE');
});

test('las respuestas no se guardan en caché del navegador y llevan nosniff', async () => {
  const { llamar } = await crearEntorno();
  const r = await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'Luis', clave: 'mala' } });
  assert.equal(r.encabezados['Cache-Control'], 'no-store');
  assert.equal(r.encabezados['X-Content-Type-Options'], 'nosniff');
});

// ---------- Ingreso ----------

test('ingresar: devuelve token, sesión y vencimiento según el rol', async () => {
  const { llamar } = await crearEntorno();
  const usuario = await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'AdrianaPR', clave: 'ClaveAdriana1' } });
  assert.equal(usuario.estado, 200);
  assert.deepEqual(usuario.cuerpo.sesion, { id: 'AdrianaPR', nombre: 'Adriana Perla R', rol: 'usuario' });
  assert.equal(usuario.cuerpo.venceEnSegundos, 4 * 3600);
  assert.deepEqual(usuario.cuerpo.consPref, [2, 3]); // para abrir la agenda en su consultorio preferido
  assert.ok(!usuario.crudo.includes('scrypt'));
  const admin = await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'Admin', clave: 'ClaveAdmin1' } });
  assert.equal(admin.cuerpo.venceEnSegundos, 12 * 3600);
});

test('ingresar: clave incorrecta y usuario inexistente reciben la misma respuesta 401', async () => {
  const { llamar } = await crearEntorno();
  const a = await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'Luis', clave: 'mala' } });
  const b = await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'Fantasma', clave: 'mala' } });
  assert.equal(a.estado, 401);
  assert.deepEqual(a.cuerpo, b.cuerpo);
});

test('el cuerpo debe ser JSON válido, un objeto y no pasarse de tamaño', async () => {
  const { llamar } = await crearEntorno();
  assert.equal((await llamar('ingresar', { metodo: 'POST', texto: '{no es json' })).cuerpo.error.codigo, 'JSON_INVALIDO');
  assert.equal((await llamar('ingresar', { metodo: 'POST', texto: '[1,2]' })).cuerpo.error.codigo, 'JSON_INVALIDO');
  const grande = await llamar('ingresar', { metodo: 'POST', texto: JSON.stringify({ usuario: 'x'.repeat(30000), clave: 'y' }) });
  assert.equal(grande.estado, 413);
});

// ---------- Sesión ----------

test('las rutas protegidas exigen un token válido', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  assert.equal((await llamar('reservas', { params: { fecha: '2026-10-19' } })).estado, 401);
  const token = await ingresarComo('Luis', 'ClaveLuis1');
  assert.equal((await llamar('reservas', { params: { fecha: '2026-10-19' }, token: `${token}x` })).cuerpo.error.codigo, 'TOKEN_INVALIDO');
  assert.equal((await llamar('reservas', { params: { fecha: '2026-10-19' }, token })).estado, 200);
});

test('un token vencido se rechaza con un mensaje claro', async () => {
  const { llamar, ingresarComo, reloj } = await crearEntorno();
  const token = await ingresarComo('Luis', 'ClaveLuis1');
  reloj.ahora = new Date(INICIO.getTime() + 5 * 3600 * 1000); // el usuario común dura 4 h
  const r = await llamar('reservas', { params: { fecha: '2026-10-19' }, token });
  assert.equal(r.estado, 401);
  assert.equal(r.cuerpo.error.codigo, 'TOKEN_VENCIDO');
});

test('un usuario dado de baja pierde el acceso de inmediato, aunque su token siga vigente', async () => {
  const { llamar, ingresarComo, almacen } = await crearEntorno();
  const token = await ingresarComo('Luis', 'ClaveLuis1');
  await almacen.actualizar((l) => l.map((u) => (u.id === 'Luis' ? { ...u, activo: false } : u)), 'baja');
  const r = await llamar('reservas', { params: { fecha: '2026-10-19' }, token });
  assert.equal(r.estado, 401);
  assert.equal(r.cuerpo.error.codigo, 'SESION_INVALIDA');
});

test('rige el rol actual del archivo, no el que diga el token', async () => {
  const { llamar, deps } = await crearEntorno();
  const tokenFalso = sesionModulo.crearToken({ id: 'Luis', nombre: 'Luis Pérez', rol: 'admin' }, SECRETO, {
    duracionSegundos: 3600,
    ahoraSegundos: Math.floor(INICIO.getTime() / 1000),
  });
  assert.ok(deps);
  const r = await llamar('usuarios', { token: tokenFalso });
  assert.equal(r.estado, 403);
});

test('si debe cambiar su clave, solo puede usar la ruta de cambio de clave', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const token = await ingresarComo('Nuevo', 'ClaveTemporal1');
  const bloqueada = await llamar('reservas', { params: { fecha: '2026-10-19' }, token });
  assert.equal(bloqueada.estado, 403);
  assert.equal(bloqueada.cuerpo.error.codigo, 'DEBE_CAMBIAR_CLAVE');

  const cambio = await llamar('clave', { metodo: 'POST', token, cuerpo: { claveActual: 'ClaveTemporal1', claveNueva: 'MiClaveNueva9' } });
  assert.equal(cambio.estado, 200);
  assert.equal((await llamar('reservas', { params: { fecha: '2026-10-19' }, token })).estado, 200);
  assert.equal((await ingresarComo('Nuevo', 'MiClaveNueva9')).length > 10, true);
});

test('cambiar la clave: la actual incorrecta da 401 y la nueva corta da 400', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const token = await ingresarComo('Luis', 'ClaveLuis1');
  assert.equal((await llamar('clave', { metodo: 'POST', token, cuerpo: { claveActual: 'x', claveNueva: 'NuevaClave99' } })).estado, 401);
  assert.equal((await llamar('clave', { metodo: 'POST', token, cuerpo: { claveActual: 'ClaveLuis1', claveNueva: 'corta' } })).estado, 400);
});

// ---------- Reservas ----------

test('un usuario reserva, ve su reserva completa y otro usuario solo ve "Ocupado"', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const ana = await ingresarComo('AdrianaPR', 'ClaveAdriana1');
  const luis = await ingresarComo('Luis', 'ClaveLuis1');

  const creada = await llamar('reservas', { metodo: 'POST', token: ana, cuerpo: RESERVA });
  assert.equal(creada.estado, 201);
  assert.equal(creada.cuerpo.reserva.titularNombre, 'Adriana Perla R');

  const vistaLuis = await llamar('reservas', { params: { fecha: '2026-10-19' }, token: luis });
  assert.equal(vistaLuis.cuerpo.reservas.length, 1);
  assert.equal(vistaLuis.cuerpo.reservas[0].ocupado, true);
  assert.ok(!vistaLuis.crudo.includes('Adriana'));
  assert.ok(!vistaLuis.crudo.includes('AdrianaPR'));

  const vistaAna = await llamar('reservas', { params: { fecha: '2026-10-19' }, token: ana });
  assert.equal(vistaAna.cuerpo.reservas[0].propia, true);
});

test('el horario ocupado devuelve 409 y las reglas devuelven su código (400)', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const ana = await ingresarComo('AdrianaPR', 'ClaveAdriana1');
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  await llamar('reservas', { metodo: 'POST', token: ana, cuerpo: RESERVA });
  assert.equal((await llamar('reservas', { metodo: 'POST', token: luis, cuerpo: { ...RESERVA, hora: '10:30' } })).estado, 409);
  const domingo = await llamar('reservas', { metodo: 'POST', token: luis, cuerpo: { ...RESERVA, fecha: '2026-10-18' } });
  assert.equal(domingo.estado, 400);
  assert.equal(domingo.cuerpo.error.codigo, 'DIA_NO_LABORAL');
});

test('un usuario no puede reservar a nombre de otro; la gestora sí, y el titular queda bien', async () => {
  const { llamar, ingresarComo, almacen } = await crearEntorno();
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  const gestora = await ingresarComo('Gestora', 'ClaveGestora1');

  const negado = await llamar('reservas', { metodo: 'POST', token: luis, cuerpo: { ...RESERVA, paraUsuario: 'AdrianaPR' } });
  assert.equal(negado.estado, 403);

  const ok = await llamar('reservas', { metodo: 'POST', token: gestora, cuerpo: { ...RESERVA, paraUsuario: 'adrianapr' } });
  assert.equal(ok.estado, 201);
  assert.equal(ok.cuerpo.reserva.titularId, 'AdrianaPR');
  assert.equal(ok.cuerpo.reserva.creadaPor, 'Gestora G');

  const inexistente = await llamar('reservas', { metodo: 'POST', token: gestora, cuerpo: { ...RESERVA, hora: '12:00', paraUsuario: 'Fantasma' } });
  assert.equal(inexistente.estado, 404);

  await almacen.actualizar((l) => l.map((u) => (u.id === 'Luis' ? { ...u, activo: false } : u)), 'baja');
  const baja = await llamar('reservas', { metodo: 'POST', token: gestora, cuerpo: { ...RESERVA, hora: '14:00', paraUsuario: 'Luis' } });
  assert.equal(baja.estado, 404);
});

test('GET con todas=1: administración y gestión ven las reservas de todos; el usuario común, no', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const ana = await ingresarComo('AdrianaPR', 'ClaveAdriana1');
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  const gestora = await ingresarComo('Gestora', 'ClaveGestora1');
  await llamar('reservas', { metodo: 'POST', token: ana, cuerpo: RESERVA });
  await llamar('reservas', { metodo: 'POST', token: luis, cuerpo: { ...RESERVA, consultorio: 3 } });

  const rango = { desde: '2026-10-15', hasta: '2026-10-31' };
  assert.equal((await llamar('reservas', { params: { ...rango, todas: '1' }, token: gestora })).cuerpo.reservas.length, 2);
  assert.equal((await llamar('reservas', { params: rango, token: gestora })).cuerpo.reservas.length, 0); // sin "todas", solo las propias
  assert.equal((await llamar('reservas', { params: { ...rango, todas: '1' }, token: luis })).estado, 403);
});

test('cancelar: el titular sí, otro usuario no; "mis reservas" solo muestra las propias', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const ana = await ingresarComo('AdrianaPR', 'ClaveAdriana1');
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  const { cuerpo: { reserva } } = await llamar('reservas', { metodo: 'POST', token: ana, cuerpo: RESERVA });

  const rango = { desde: '2026-10-15', hasta: '2026-10-31' };
  assert.equal((await llamar('reservas', { params: rango, token: ana })).cuerpo.reservas.length, 1);
  assert.equal((await llamar('reservas', { params: rango, token: luis })).cuerpo.reservas.length, 0);
  assert.equal((await llamar('reservas', { params: { ...rango, usuario: 'AdrianaPR' }, token: luis })).estado, 403);

  assert.equal((await llamar('reservas', { metodo: 'DELETE', params: { id: reserva.id }, token: luis })).estado, 403);
  const cancelada = await llamar('reservas', { metodo: 'DELETE', params: { id: reserva.id }, token: ana });
  assert.equal(cancelada.estado, 200);
  assert.equal(cancelada.cuerpo.reserva.cancelada, true);
  assert.equal((await llamar('reservas', { params: rango, token: ana })).cuerpo.reservas.length, 0);
  assert.equal((await llamar('reservas', { metodo: 'DELETE', params: { id: 'no-existe' }, token: ana })).estado, 404);
  assert.equal((await llamar('reservas', { metodo: 'DELETE', token: ana })).estado, 400);
});

test('consultar la grilla exige los parámetros correctos', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  assert.equal((await llamar('reservas', { token: luis })).cuerpo.error.codigo, 'PARAMETROS_INVALIDOS');
  assert.equal((await llamar('reservas', { params: { fecha: 'mañana' }, token: luis })).cuerpo.error.codigo, 'FECHA_INVALIDA');
});

// ---------- Bloqueos ----------

test('bloqueos: un usuario no puede; la gestora sí, y los usuarios lo ven como "Ocupado" sin la observación', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  const gestora = await ingresarComo('Gestora', 'ClaveGestora1');
  const bloqueo = { consultorios: [0], fecha: '2026-10-19', horaInicio: '09:00', horaFin: '12:00', observacion: 'Mantenimiento' };

  assert.equal((await llamar('bloqueos', { metodo: 'POST', token: luis, cuerpo: bloqueo })).estado, 403);
  const creado = await llamar('bloqueos', { metodo: 'POST', token: gestora, cuerpo: bloqueo });
  assert.equal(creado.estado, 201);
  assert.equal(creado.cuerpo.reservas[0].observacion, 'Mantenimiento');

  const vistaLuis = await llamar('reservas', { params: { fecha: '2026-10-19' }, token: luis });
  assert.equal(vistaLuis.cuerpo.reservas[0].ocupado, true);
  assert.ok(!vistaLuis.crudo.includes('Mantenimiento'));
  assert.equal((await llamar('reservas', { metodo: 'POST', token: luis, cuerpo: { ...RESERVA, consultorio: 4 } })).estado, 409);

  // La gestora puede listar los bloqueos vigentes; el usuario no.
  const lista = await llamar('bloqueos', { params: { desde: '2026-10-15', hasta: '2026-10-31' }, token: gestora });
  assert.equal(lista.estado, 200);
  assert.equal(lista.cuerpo.reservas[0].observacion, 'Mantenimiento');
  assert.equal((await llamar('bloqueos', { params: { desde: '2026-10-15', hasta: '2026-10-31' }, token: luis })).estado, 403);
  assert.equal((await llamar('bloqueos', { token: gestora })).estado, 400);

  // Se deshace cancelando el bloqueo.
  const id = creado.cuerpo.reservas[0].id;
  assert.equal((await llamar('reservas', { metodo: 'DELETE', params: { id }, token: luis })).estado, 403);
  assert.equal((await llamar('reservas', { metodo: 'DELETE', params: { id }, token: gestora })).estado, 200);
});

// ---------- Usuarios ----------

test('usuarios: solo admin y gestor; la lista no trae contraseñas', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  const gestora = await ingresarComo('Gestora', 'ClaveGestora1');
  assert.equal((await llamar('usuarios', { token: luis })).estado, 403);
  const lista = await llamar('usuarios', { token: gestora });
  assert.equal(lista.estado, 200);
  assert.equal(lista.cuerpo.usuarios.length, 5);
  assert.ok(!lista.crudo.includes('scrypt'));
  assert.ok(!lista.crudo.includes('contrasena'));
});

test('usuarios: alta con clave temporal que sirve para ingresar y obliga a cambiarla', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const admin = await ingresarComo('Admin', 'ClaveAdmin1');
  const alta = await llamar('usuarios', { metodo: 'POST', token: admin, cuerpo: { id: 'Maria', nombre: 'María Gómez', rol: 'usuario' } });
  assert.equal(alta.estado, 201);
  assert.equal(alta.cuerpo.usuario.requiereCambioPass, true);
  assert.equal(alta.cuerpo.claveTemporal, 'Maria1234567'); // clave inicial simple de usuarios comunes
  assert.equal(alta.cuerpo.venceEl, '2026-10-22');
  const ingreso = await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'Maria', clave: alta.cuerpo.claveTemporal } });
  assert.equal(ingreso.estado, 200);
  assert.equal(ingreso.cuerpo.requiereCambioPass, true);
  assert.equal((await llamar('usuarios', { metodo: 'POST', token: admin, cuerpo: { id: 'Maria', nombre: 'Otra', rol: 'usuario' } })).estado, 409);
});

test('usuarios: editar por PATCH, reiniciar clave y reglas del gestor', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const admin = await ingresarComo('Admin', 'ClaveAdmin1');
  const gestora = await ingresarComo('Gestora', 'ClaveGestora1');

  const edicion = await llamar('usuarios', { metodo: 'PATCH', params: { id: 'Luis' }, token: admin, cuerpo: { nombre: 'Luis P.', consPref: [1, 2] } });
  assert.equal(edicion.estado, 200);
  assert.equal(edicion.cuerpo.usuario.nombre, 'Luis P.');
  assert.equal((await llamar('usuarios', { metodo: 'PATCH', token: admin, cuerpo: { nombre: 'X' } })).estado, 400);
  assert.equal((await llamar('usuarios', { metodo: 'PATCH', params: { id: 'Admin' }, token: gestora, cuerpo: { nombre: 'Hackeado' } })).estado, 403);

  const reinicio = await llamar('usuarios', { metodo: 'POST', params: { id: 'Luis', accion: 'reiniciar-clave' }, token: gestora });
  assert.equal(reinicio.estado, 200);
  assert.equal((await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'Luis', clave: 'ClaveLuis1' } })).estado, 401);
  assert.equal((await llamar('ingresar', { metodo: 'POST', cuerpo: { usuario: 'Luis', clave: reinicio.cuerpo.claveTemporal } })).estado, 200);
  assert.equal((await llamar('usuarios', { metodo: 'POST', params: { id: 'Admin', accion: 'reiniciar-clave' }, token: gestora })).estado, 403);
});

test('dar de baja a alguien lo deja afuera de inmediato incluso con sesión abierta', async () => {
  const { llamar, ingresarComo } = await crearEntorno();
  const admin = await ingresarComo('Admin', 'ClaveAdmin1');
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  assert.equal((await llamar('reservas', { params: { fecha: '2026-10-19' }, token: luis })).estado, 200);
  await llamar('usuarios', { metodo: 'PATCH', params: { id: 'Luis' }, token: admin, cuerpo: { activo: false } });
  assert.equal((await llamar('reservas', { params: { fecha: '2026-10-19' }, token: luis })).estado, 401);
});

// ---------- Errores internos y configuración ----------

test('un error inesperado no filtra detalles al navegador', async () => {
  const { llamar, ingresarComo, repo } = await crearEntorno();
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  repo.listarDia = async () => { throw new Error('clave-secreta-123 en el servidor'); };
  const silencio = console.error;
  const registrados = [];
  console.error = (m) => registrados.push(m);
  try {
    const r = await llamar('reservas', { params: { fecha: '2026-10-19' }, token: luis });
    assert.equal(r.estado, 500);
    assert.equal(r.cuerpo.error.codigo, 'ERROR_INTERNO');
    assert.ok(!r.crudo.includes('clave-secreta-123'));
  } finally {
    console.error = silencio;
  }
  assert.ok(registrados.some((m) => String(m).includes('clave-secreta-123'))); // queda en el log del servidor
});

test('configuración incompleta: en modo pruebas se indica qué variable falta; en producción, no', async () => {
  const fallida = async () => { throw new ConfiguracionIncompleta(['falta ESPACIAV2_GITHUB_TOKEN']); };
  const manejador = manejadores.ingresar.crearHandler(fallida);
  const evento = { httpMethod: 'POST', headers: {}, body: JSON.stringify({ usuario: 'a', clave: 'b' }) };
  const modoOriginal = process.env.ESPACIAV2_MODO;
  const silencio = console.error;
  console.error = () => {};
  try {
    process.env.ESPACIAV2_MODO = 'pruebas';
    const enPruebas = await manejador(evento);
    assert.equal(enPruebas.statusCode, 500);
    assert.deepEqual(JSON.parse(enPruebas.body).detalle, ['falta ESPACIAV2_GITHUB_TOKEN']);

    process.env.ESPACIAV2_MODO = 'produccion';
    const enProduccion = await manejador(evento);
    assert.equal(enProduccion.statusCode, 500);
    assert.ok(!enProduccion.body.includes('ESPACIAV2_GITHUB_TOKEN'));
  } finally {
    console.error = silencio;
    if (modoOriginal === undefined) delete process.env.ESPACIAV2_MODO;
    else process.env.ESPACIAV2_MODO = modoOriginal;
  }
});

test('modo pruebas: un error interno muestra el motivo; en producción, no', async () => {
  const { llamar, ingresarComo, repo } = await crearEntorno();
  const luis = await ingresarComo('Luis', 'ClaveLuis1');
  repo.listarDia = async () => { throw new Error('No se encontró el archivo de usuarios'); };
  const modoOriginal = process.env.ESPACIAV2_MODO;
  const silencio = console.error;
  console.error = () => {};
  try {
    process.env.ESPACIAV2_MODO = 'pruebas';
    const enPruebas = await llamar('reservas', { params: { fecha: '2026-10-19' }, token: luis });
    assert.equal(enPruebas.estado, 500);
    assert.match(enPruebas.cuerpo.detalle[0], /No se encontró el archivo de usuarios/);

    process.env.ESPACIAV2_MODO = 'produccion';
    const enProduccion = await llamar('reservas', { params: { fecha: '2026-10-19' }, token: luis });
    assert.equal(enProduccion.estado, 500);
    assert.equal(enProduccion.cuerpo.detalle, undefined);
    assert.ok(!enProduccion.crudo.includes('No se encontró'));
  } finally {
    console.error = silencio;
    if (modoOriginal === undefined) delete process.env.ESPACIAV2_MODO;
    else process.env.ESPACIAV2_MODO = modoOriginal;
  }
});

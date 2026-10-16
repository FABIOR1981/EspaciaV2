// Espacia — arranque de la aplicación: ingreso, cambio de clave obligatorio y navegación entre vistas.

import { el, icono, iniciales, etiquetaRol } from './utilidades.js';
import { crearApi } from './api.js';
import * as almacenSesion from './sesion.js';
import { abrirHoja, mostrarAviso } from './hojas.js';
import { crearPantallaIngreso, crearPantallaCambioObligatorio, crearFormularioClave, crearMarca } from './vista_ingreso.js';
import { crearVistaAgenda } from './vista_agenda.js';
import { crearVistaMisReservas } from './vista_mis_reservas.js';
import { crearVistaGestion } from './vista_gestion.js';

const raiz = document.getElementById('app');

let reglas = null;
let sesion = almacenSesion.leer();
let vistaActual = null;
let escuchaHash = null;
let sesionCerrandose = false;

const api = crearApi({
  obtenerToken: () => (sesion ? sesion.token : null),
  alSesionInvalida: (codigo) => {
    if (sesionCerrandose) return;
    cerrarSesion(codigo === 'TOKEN_VENCIDO' ? 'La sesión venció. Ingresá de nuevo.' : 'Tu sesión ya no es válida. Ingresá de nuevo.');
  },
  alDebeCambiarClave: () => {
    if (sesion) {
      sesion = { ...sesion, requiereCambioPass: true };
      almacenSesion.guardar(sesion);
      mostrarCambioObligatorio();
    }
  },
});

function limpiarVista() {
  if (vistaActual) vistaActual.destruir();
  vistaActual = null;
  if (escuchaHash) window.removeEventListener('hashchange', escuchaHash);
  escuchaHash = null;
}

function cerrarSesion(mensaje) {
  sesionCerrandose = true;
  sesion = null;
  almacenSesion.borrar();
  mostrarIngreso(mensaje);
  sesionCerrandose = false;
}

function mostrarIngreso(mensaje) {
  limpiarVista();
  raiz.replaceChildren(
    crearPantallaIngreso({
      api,
      mensajeInicial: mensaje,
      alIngresar: (datos) => {
        sesion = { token: datos.token, ...datos.sesion, consPref: datos.consPref, requiereCambioPass: datos.requiereCambioPass, venceEn: Date.now() + datos.venceEnSegundos * 1000 };
        almacenSesion.guardar(sesion);
        if (sesion.requiereCambioPass) mostrarCambioObligatorio();
        else entrarALaApp();
      },
    })
  );
}

function mostrarCambioObligatorio() {
  limpiarVista();
  raiz.replaceChildren(
    crearPantallaCambioObligatorio({
      api,
      nombre: sesion.nombre,
      alExito: () => {
        sesion = { ...sesion, requiereCambioPass: false };
        almacenSesion.guardar(sesion);
        mostrarAviso('Clave actualizada.');
        entrarALaApp();
      },
      alSalir: () => cerrarSesion(),
    })
  );
}

function abrirCuenta() {
  const cuerpo = el(
    'div',
    {},
    el('dl', { clase: 'datos' }, el('dt', {}, 'Nombre'), el('dd', {}, sesion.nombre), el('dt', {}, 'Usuario'), el('dd', {}, sesion.id), el('dt', {}, 'Perfil'), el('dd', {}, etiquetaRol(sesion.rol))),
    el(
      'div',
      { clase: 'hoja-acciones' },
      el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => { hoja.cerrar(); abrirCambioClave(); } }, 'Cambiar clave'),
      el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => { hoja.cerrar(); cerrarSesion(); } }, 'Salir')
    )
  );
  const hoja = abrirHoja({ titulo: 'Mi cuenta', cuerpo });
}

function abrirCambioClave() {
  const hoja = abrirHoja({
    titulo: 'Cambiar clave',
    cuerpo: crearFormularioClave({
      api,
      textoBoton: 'Guardar clave',
      alExito: () => { hoja.cerrar(); mostrarAviso('Clave actualizada.'); },
      alCancelar: () => hoja.cerrar(),
    }),
  });
}

function entrarALaApp() {
  limpiarVista();

  const principal = el('main', { clase: 'principal', id: 'principal' });
  const enlaceAgenda = el('a', { href: '#agenda' }, 'Agenda');
  const enlaceMisReservas = el('a', { href: '#mis-reservas' }, 'Mis reservas');
  const inferiorAgenda = el('a', { href: '#agenda' }, icono('agenda'), 'Agenda');
  const inferiorMis = el('a', { href: '#mis-reservas' }, icono('lista'), 'Mis reservas');

  const administrativo = sesion.rol === 'admin' || sesion.rol === 'gestor';
  const enlaceGestion = administrativo ? el('a', { href: '#gestion' }, 'Gestión') : null;
  const inferiorGestion = administrativo ? el('a', { href: '#gestion' }, icono('gestion'), 'Gestión') : null;

  const botonCuenta = el(
    'button',
    { clase: 'cuenta-boton', type: 'button', 'aria-label': `Mi cuenta: ${sesion.nombre}`, enClick: abrirCuenta },
    el('span', { clase: 'iniciales' }, iniciales(sesion.nombre)),
    el('span', { clase: 'nombre' }, sesion.nombre)
  );

  const barra = el('header', { clase: 'barra' }, crearMarca(), el('nav', { clase: 'nav-principal', 'aria-label': 'Principal' }, enlaceAgenda, enlaceMisReservas, enlaceGestion), botonCuenta);
  const navInferior = el('nav', { clase: 'nav-inferior', 'aria-label': 'Principal' }, inferiorAgenda, inferiorMis, inferiorGestion);
  raiz.replaceChildren(barra, principal, navInferior);

  const vistas = {
    agenda: crearVistaAgenda({ api, reglas, sesion }),
    'mis-reservas': crearVistaMisReservas({ api, reglas, sesion, irAAgenda: () => { location.hash = '#agenda'; } }),
    ...(administrativo ? { gestion: crearVistaGestion({ api, reglas, sesion }) } : {}),
  };
  let activa = null;

  const mostrar = () => {
    const pedida = location.hash.slice(1);
    const nombre = vistas[pedida] ? pedida : 'agenda';
    if (activa === nombre) return;
    if (activa) vistas[activa].desactivar();
    activa = nombre;
    principal.replaceChildren(vistas[nombre].nodo);
    vistas[nombre].activar();
    for (const [enlace, objetivo] of [[enlaceAgenda, 'agenda'], [inferiorAgenda, 'agenda'], [enlaceMisReservas, 'mis-reservas'], [inferiorMis, 'mis-reservas'], [enlaceGestion, 'gestion'], [inferiorGestion, 'gestion']]) {
      if (!enlace) continue;
      if (objetivo === nombre) enlace.setAttribute('aria-current', 'page');
      else enlace.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  };

  escuchaHash = mostrar;
  window.addEventListener('hashchange', escuchaHash);
  vistaActual = { destruir: () => Object.values(vistas).forEach((v) => v.destruir()) };
  mostrar();
}

async function iniciar() {
  const r = await api.reglas();
  if (!r.ok) {
    raiz.replaceChildren(
      el(
        'div',
        { clase: 'estado-pantalla' },
        el('div', {}, el('h1', {}, 'No pudimos abrir Espacia'), el('p', {}, r.error.mensaje), r.detalle ? el('p', { clase: 'detalle-tecnico' }, r.detalle.join(' · ')) : null, el('button', { clase: 'boton boton-primario', type: 'button', enClick: () => location.reload() }, 'Reintentar'))
      )
    );
    return;
  }
  reglas = r.datos;
  if (!sesion) mostrarIngreso();
  else if (sesion.requiereCambioPass) mostrarCambioObligatorio();
  else entrarALaApp();
}

iniciar();

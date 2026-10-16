// Gestión (solo administración y gestión): bloqueos de horarios y usuarios.

import {
  el, reemplazarHijos, ahoraEn, sumarDias, diaDeSemana, fechaLarga, capitalizar, minutosAHora, rangoHoras, horarioDelDia, nombreSala, colorSala, etiquetaRol,
} from './utilidades.js';
import { abrirHojaDetalle } from './hojas_reservas.js';
import { mostrarAviso } from './hojas.js';
import { abrirHojaUsuario, abrirHojaReinicio, puedeAdministrar } from './hojas_usuarios.js';

export function crearVistaGestion({ api, reglas, sesion }) {
  const nodo = el('section', { clase: 'gestion', 'aria-label': 'Gestión' });
  const hoy = () => ahoraEn(reglas.zonaHoraria);
  let pestana = 'bloqueos';
  let activa = false;

  const botonesPestana = {};
  const pestanas = el('div', { clase: 'pestanas', role: 'tablist', 'aria-label': 'Herramientas de gestión' });
  for (const [id, texto] of [['bloqueos', 'Bloqueos'], ['usuarios', 'Usuarios']]) {
    const boton = el('button', { clase: 'pestana', type: 'button', role: 'tab', id: `pestana-${id}`, 'aria-selected': id === pestana, enClick: () => elegir(id) }, texto);
    botonesPestana[id] = boton;
    pestanas.append(boton);
  }
  const panel = el('div', { clase: 'gestion-panel', role: 'tabpanel' });
  nodo.append(el('h1', { clase: 'gestion-titulo' }, 'Gestión'), pestanas, panel);

  function elegir(id) {
    pestana = id;
    for (const [clave, boton] of Object.entries(botonesPestana)) boton.setAttribute('aria-selected', String(clave === id));
    panel.setAttribute('aria-labelledby', `pestana-${id}`);
    if (id === 'bloqueos') dibujarBloqueos();
    else dibujarUsuarios();
  }

  // ====================== BLOQUEOS ======================

  function opcionesHora(fecha, esFin) {
    const horario = horarioDelDia(reglas, fecha);
    if (!horario) return [];
    const opciones = [];
    const tramo = reglas.tramoMinutos;
    for (let m = horario.inicio + (esFin ? tramo : 0); m <= horario.fin - (esFin ? 0 : tramo); m += tramo) opciones.push(m);
    return opciones;
  }

  function dibujarBloqueos() {
    const limiteMax = sesion.rol === 'admin' ? sumarDias(hoy().fecha, 365) : sumarDias(hoy().fecha, reglas.reserva.maxSemanasAdelante * 7);
    let fechaInicial = sumarDias(hoy().fecha, 1);
    while (!reglas.diasLaborales.includes(diaDeSemana(fechaInicial))) fechaInicial = sumarDias(fechaInicial, 1);

    const campoFecha = el('input', { id: 'bloqueo-fecha', type: 'date', value: fechaInicial, min: hoy().fecha, max: limiteMax });
    const campoDiaCompleto = el('input', { id: 'bloqueo-dia-completo', type: 'checkbox' });
    const campoDesde = el('select', { id: 'bloqueo-desde' });
    const campoHasta = el('select', { id: 'bloqueo-hasta' });
    const campoMotivo = el('input', { id: 'bloqueo-motivo', type: 'text', maxlength: 100, autocomplete: 'off', placeholder: 'Por ejemplo: mantenimiento' });
    const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
    const boton = el('button', { clase: 'boton boton-primario', type: 'submit' }, 'Bloquear horario');

    // Consultorios: "Todos" o una selección
    const casillaTodos = el('input', { type: 'checkbox', name: 'consultorio-todos' });
    const grupoSalas = el('div', { clase: 'opciones opciones-compactas' });
    const casillasSalas = [];
    for (let n = 1; n <= reglas.espacios.cantidad; n += 1) {
      const casilla = el('input', { type: 'checkbox', name: 'consultorio', value: n });
      casillasSalas.push(casilla);
      grupoSalas.append(el('label', { clase: 'opcion' }, casilla, el('span', { clase: 'opcion-cuerpo' }, el('strong', {}, String(n)))));
    }
    casillaTodos.addEventListener('change', () => {
      for (const c of casillasSalas) {
        c.disabled = casillaTodos.checked;
        if (casillaTodos.checked) c.checked = false;
      }
    });

    const rellenarHoras = () => {
      const f = campoFecha.value;
      const desdes = opcionesHora(f, false);
      const hastas = opcionesHora(f, true);
      campoDesde.replaceChildren(...desdes.map((m) => el('option', { value: m }, minutosAHora(m))));
      campoHasta.replaceChildren(...hastas.map((m) => el('option', { value: m }, minutosAHora(m))));
      if (hastas.length) campoHasta.value = String(Math.min(hastas[hastas.length - 1], (Number(campoDesde.value) || 0) + 60));
    };
    const actualizarDiaCompleto = () => {
      campoDesde.disabled = campoDiaCompleto.checked;
      campoHasta.disabled = campoDiaCompleto.checked;
    };
    campoFecha.addEventListener('change', rellenarHoras);
    campoDesde.addEventListener('change', () => {
      const minimo = Number(campoDesde.value) + reglas.tramoMinutos;
      if (Number(campoHasta.value) < minimo) campoHasta.value = String(minimo);
    });
    campoDiaCompleto.addEventListener('change', actualizarDiaCompleto);
    rellenarHoras();

    const error = (texto) => {
      mensaje.textContent = texto;
      mensaje.hidden = false;
    };

    const formulario = el(
      'form',
      {
        novalidate: true,
        enSubmit: async (evento) => {
          evento.preventDefault();
          mensaje.hidden = true;
          if (!campoFecha.value) return error('Elegí la fecha.');
          if (!reglas.diasLaborales.includes(diaDeSemana(campoFecha.value))) return error('Ese día no hay atención.');
          const consultorios = casillaTodos.checked ? [0] : casillasSalas.filter((c) => c.checked).map((c) => Number(c.value));
          if (consultorios.length === 0) return error('Elegí "Todos" o al menos un consultorio.');
          const datos = { consultorios, fecha: campoFecha.value, observacion: campoMotivo.value.trim() };
          if (campoDiaCompleto.checked) datos.diaCompleto = true;
          else {
            if (Number(campoHasta.value) <= Number(campoDesde.value)) return error('La hora de fin debe ser posterior a la de inicio.');
            datos.horaInicio = minutosAHora(Number(campoDesde.value));
            datos.horaFin = minutosAHora(Number(campoHasta.value));
          }
          boton.disabled = true;
          const r = await api.crearBloqueo(datos);
          boton.disabled = false;
          if (!r.ok) return error(r.error.mensaje);
          mostrarAviso(`Horario bloqueado: ${capitalizar(fechaLarga(datos.fecha))}.`);
          campoMotivo.value = '';
          cargarLista();
          return undefined;
        },
      },
      mensaje,
      el('div', { clase: 'campo' }, el('label', { for: 'bloqueo-fecha' }, 'Día'), campoFecha),
      el('fieldset', { clase: 'campo' }, el('legend', {}, 'Consultorios'), el('label', { clase: 'casilla' }, casillaTodos, ' Todos los consultorios'), grupoSalas),
      el('div', { clase: 'campo' }, el('label', { clase: 'casilla' }, campoDiaCompleto, ' Todo el día'), el('span', { clase: 'campo-ayuda' }, 'Cubre el horario de atención de ese día.')),
      el('div', { clase: 'par-campos' }, el('div', { clase: 'campo' }, el('label', { for: 'bloqueo-desde' }, 'Desde'), campoDesde), el('div', { clase: 'campo' }, el('label', { for: 'bloqueo-hasta' }, 'Hasta'), campoHasta)),
      el('div', { clase: 'campo' }, el('label', { for: 'bloqueo-motivo' }, 'Motivo (opcional)'), campoMotivo, el('span', { clase: 'campo-ayuda' }, 'Solo lo ve el personal de gestión; los usuarios ven "Ocupado".')),
      boton
    );

    const lista = el('div', { clase: 'bloqueos-lista', 'aria-live': 'polite' });
    async function cargarLista() {
      reemplazarHijos(lista, el('p', { clase: 'campo-ayuda', role: 'status' }, 'Cargando bloqueos…'));
      const desde = hoy().fecha;
      const r = await api.bloqueos(desde, sumarDias(desde, 12 * 7));
      if (!activa || pestana !== 'bloqueos') return;
      if (!r.ok) {
        reemplazarHijos(lista, el('div', { clase: 'mensaje-error', role: 'alert' }, r.error.mensaje), el('button', { clase: 'boton boton-secundario', type: 'button', enClick: cargarLista }, 'Reintentar'));
        return;
      }
      const vigentes = r.datos.reservas.filter((x) => x.fecha > desde || x.finMin > hoy().minutos);
      if (vigentes.length === 0) {
        reemplazarHijos(lista, el('p', { clase: 'campo-ayuda' }, 'No hay bloqueos vigentes.'));
        return;
      }
      const grupos = new Map();
      for (const x of vigentes) grupos.set(x.fecha, [...(grupos.get(x.fecha) || []), x]);
      const nodos = [];
      for (const [fecha, items] of grupos) {
        const grupo = el('div', { clase: 'grupo-fecha' }, el('h3', {}, capitalizar(fechaLarga(fecha))));
        for (const x of items) {
          const fila = el(
            'div',
            { clase: 'reserva-fila' },
            el('span', { clase: 'reserva-hora' }, rangoHoras(x.inicioMin, x.finMin)),
            el('span', { clase: 'reserva-sala' }, nombreSala(reglas, x.consultorio), x.observacion ? ` · ${x.observacion}` : ''),
            el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => abrirHojaDetalle({ reglas, sesion, api, reserva: x, alCancelada: cargarLista }) }, 'Quitar')
          );
          fila.style.setProperty('--sala-color', colorSala(x.consultorio));
          grupo.append(fila);
        }
        nodos.push(grupo);
      }
      reemplazarHijos(lista, nodos);
    }

    reemplazarHijos(
      panel,
      el(
        'div',
        { clase: 'gestion-columnas' },
        el('div', { clase: 'tarjeta' }, el('h2', {}, 'Nuevo bloqueo'), formulario),
        el('div', { clase: 'tarjeta' }, el('h2', {}, 'Bloqueos vigentes'), lista)
      )
    );
    cargarLista();
  }

  // ====================== USUARIOS ======================

  async function dibujarUsuarios() {
    const buscador = el('input', { id: 'usuarios-buscar', type: 'text', placeholder: 'Buscar por nombre o usuario', autocomplete: 'off', 'aria-label': 'Buscar usuario' });
    const lista = el('div', { clase: 'usuarios-lista' });
    const resumen = el('p', { clase: 'campo-ayuda', 'aria-live': 'polite' });
    let usuarios = [];

    const dibujarLista = () => {
      const filtro = buscador.value.trim().toLowerCase();
      const visibles = usuarios.filter((u) => !filtro || u.nombre.toLowerCase().includes(filtro) || u.id.toLowerCase().includes(filtro));
      resumen.textContent = `${visibles.length} de ${usuarios.length} usuarios`;
      if (visibles.length === 0) {
        reemplazarHijos(lista, el('p', { clase: 'vacio' }, 'No hay usuarios con ese dato.'));
        return;
      }
      reemplazarHijos(
        lista,
        visibles.map((u) => {
          const administrable = puedeAdministrar(sesion, u);
          return el(
            'div',
            { clase: `usuario-fila${u.activo ? '' : ' usuario-inactivo'}` },
            el(
              'div',
              { clase: 'usuario-datos' },
              el('strong', {}, u.nombre),
              el('span', { clase: 'usuario-id' }, u.id),
              el(
                'span',
                { clase: 'etiquetas' },
                el('span', { clase: `etiqueta etiqueta-${u.rol}` }, etiquetaRol(u.rol)),
                u.activo ? null : el('span', { clase: 'etiqueta etiqueta-baja' }, 'Inactivo'),
                u.requiereCambioPass ? el('span', { clase: 'etiqueta etiqueta-pendiente' }, 'Debe cambiar la clave') : null,
                el('span', { clase: 'etiqueta' }, `Consultorios ${u.consPref.join(', ')}`)
              )
            ),
            administrable
              ? el(
                  'div',
                  { clase: 'usuario-acciones' },
                  el('button', { clase: 'boton boton-secundario', type: 'button', 'aria-label': `Editar a ${u.nombre}`, enClick: () => abrirHojaUsuario({ reglas, sesion, api, usuario: u, alGuardado: cargar }) }, 'Editar'),
                  el('button', { clase: 'boton boton-texto', type: 'button', 'aria-label': `Reiniciar la clave de ${u.nombre}`, enClick: () => abrirHojaReinicio({ api, usuario: u }) }, 'Reiniciar clave')
                )
              : null
          );
        })
      );
    };

    async function cargar() {
      const r = await api.usuarios();
      if (!activa || pestana !== 'usuarios') return;
      if (!r.ok) {
        reemplazarHijos(lista, el('div', { clase: 'mensaje-error', role: 'alert' }, r.error.mensaje), el('button', { clase: 'boton boton-secundario', type: 'button', enClick: cargar }, 'Reintentar'));
        return;
      }
      usuarios = r.datos.usuarios;
      dibujarLista();
    }

    buscador.addEventListener('input', dibujarLista);
    reemplazarHijos(
      panel,
      el(
        'div',
        { clase: 'tarjeta' },
        el(
          'div',
          { clase: 'usuarios-barra' },
          el('div', { clase: 'campo' }, buscador),
          el('button', { clase: 'boton boton-primario', type: 'button', enClick: () => abrirHojaUsuario({ reglas, sesion, api, usuario: null, alGuardado: cargar }) }, 'Nuevo usuario')
        ),
        resumen,
        lista
      )
    );
    reemplazarHijos(lista, el('p', { clase: 'campo-ayuda', role: 'status' }, 'Cargando usuarios…'));
    cargar();
  }

  return {
    nodo,
    activar() { activa = true; elegir(pestana); },
    desactivar() { activa = false; },
    destruir() { activa = false; },
  };
}

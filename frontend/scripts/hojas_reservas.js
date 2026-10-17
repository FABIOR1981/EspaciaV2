// Ventanas para reservar un horario y para ver o cancelar una reserva.

import { el, reemplazarHijos, rangoHoras, minutosAHora, fechaLarga, nombreSala, colorSala, horarioDelDia } from './utilidades.js';
import { abrirHoja, mostrarAviso } from './hojas.js';
import { abrirHojaMover } from './hojas_mover.js';

const esAdministrativo = (rol) => rol === 'admin' || rol === 'gestor';

export function etiquetaSala(reglas, numero) {
  const punto = el('span', { clase: 'punto' });
  punto.style.setProperty('--sala-color', colorSala(numero));
  return el('span', { clase: 'sala-etiqueta' }, punto, nombreSala(reglas, numero));
}

/** Intervalos ya ocupados que afectan a un consultorio (un bloqueo de "todos" afecta a todos). */
export function ocupadosDe(reservas, consultorio) {
  return reservas.filter((r) => r.consultorio === consultorio || r.consultorio === 0).map((r) => [r.inicioMin, r.finMin]);
}

export function cabeEn(ocupados, horario, ahora, esUsuario, fecha, inicio, duracion) {
  const fin = inicio + duracion;
  if (inicio < horario.inicio || fin > horario.fin) return false;
  if (esUsuario && fecha === ahora.fecha && inicio < ahora.minutos) return false;
  return !ocupados.some(([desde, hasta]) => desde < fin && inicio < hasta);
}

/**
 * Hoja para reservar. contexto = { consultorio, fecha, inicioMin, reservas, ahora }
 */
export function abrirHojaReserva({ reglas, sesion, api, contexto, alReservado }) {
  const { consultorio, fecha, reservas, ahora } = contexto;
  const horario = horarioDelDia(reglas, fecha);
  const ocupados = ocupadosDe(reservas, consultorio);
  const esUsuario = !esAdministrativo(sesion.rol);
  const duraciones = reglas.duracionesMinutos;
  const minimo = Math.min(...duraciones);
  const cabe = (inicio, duracion) => cabeEn(ocupados, horario, ahora, esUsuario, fecha, inicio, duracion);

  const inicios = [];
  for (let m = horario.inicio; m + minimo <= horario.fin; m += reglas.tramoMinutos) if (cabe(m, minimo)) inicios.push(m);

  const selectorInicio = el('select', { id: 'reserva-inicio' }, inicios.map((m) => el('option', { value: m, selected: m === contexto.inicioMin }, minutosAHora(m))));
  if (!inicios.includes(contexto.inicioMin)) selectorInicio.selectedIndex = 0;

  const opciones = el('div', { clase: 'opciones', role: 'radiogroup' });
  const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
  const botonReservar = el('button', { clase: 'boton boton-primario', type: 'submit' }, 'Reservar');

  const selectorTitular = esUsuario ? null : el('select', { id: 'reserva-para', disabled: true }, el('option', { value: '' }, 'Cargando usuarios…'));

  const dibujarDuraciones = () => {
    const inicio = Number(selectorInicio.value);
    const elegida = opciones.querySelector('input:checked');
    const previa = elegida ? Number(elegida.value) : null;
    opciones.replaceChildren();
    let marcada = false;
    for (const duracion of duraciones) {
      const disponible = cabe(inicio, duracion);
      const marcar = disponible && !marcada && (previa === null || previa === duracion || !cabe(inicio, previa));
      if (marcar) marcada = true;
      opciones.append(
        el(
          'label',
          { clase: 'opcion' },
          el('input', { type: 'radio', name: 'duracion', value: duracion, checked: marcar, disabled: !disponible }),
          el('span', { clase: 'opcion-cuerpo' }, el('strong', {}, `${duracion} min`), el('span', {}, disponible ? `hasta ${minutosAHora(inicio + duracion)}` : 'No hay tiempo libre'))
        )
      );
    }
  };
  selectorInicio.addEventListener('change', dibujarDuraciones);
  dibujarDuraciones();

  const formulario = el(
    'form',
    {
      novalidate: true,
      enSubmit: async (evento) => {
        evento.preventDefault();
        mensaje.hidden = true;
        const elegida = opciones.querySelector('input:checked');
        if (!elegida) {
          mensaje.textContent = 'Elegí una duración.';
          mensaje.hidden = false;
          return;
        }
        botonReservar.disabled = true;
        botonReservar.textContent = 'Reservando…';
        const datos = { consultorio, fecha, hora: minutosAHora(Number(selectorInicio.value)), duracion: Number(elegida.value) };
        if (selectorTitular && selectorTitular.value) datos.paraUsuario = selectorTitular.value;
        const r = await api.reservar(datos);
        botonReservar.disabled = false;
        botonReservar.textContent = 'Reservar';
        if (r.ok) {
          const inicio = r.datos.reserva.inicioMin;
          mostrarAviso(`Reserva confirmada: ${nombreSala(reglas, consultorio)}, ${fechaLarga(fecha)}, ${rangoHoras(inicio, r.datos.reserva.finMin)}.`);
          hoja.cerrar();
          alReservado();
          return;
        }
        mensaje.replaceChildren(r.error.mensaje);
        if (r.detalle) mensaje.append(el('p', { clase: 'detalle-tecnico' }, r.detalle.join(' · ')));
        mensaje.hidden = false;
        if (r.error.codigo === 'HORARIO_OCUPADO') alReservado(); // actualiza la agenda de fondo
      },
    },
    el('dl', { clase: 'datos' }, el('dt', {}, 'Consultorio'), el('dd', {}, etiquetaSala(reglas, consultorio)), el('dt', {}, 'Día'), el('dd', {}, fechaLarga(fecha))),
    mensaje,
    el('div', { clase: 'campo' }, el('label', { for: 'reserva-inicio' }, 'Hora de inicio'), selectorInicio),
    el('fieldset', { clase: 'campo' }, el('legend', {}, 'Duración'), opciones),
    selectorTitular ? el('div', { clase: 'campo' }, el('label', { for: 'reserva-para' }, 'Reservar para'), selectorTitular) : null,
    el('div', { clase: 'hoja-acciones' }, botonReservar, el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => hoja.cerrar() }, 'Volver'))
  );

  const hoja = abrirHoja({ titulo: 'Reservar', cuerpo: formulario });

  if (selectorTitular) {
    api.usuarios().then((r) => {
      selectorTitular.replaceChildren(el('option', { value: '' }, `Yo (${sesion.nombre})`));
      if (r.ok) {
        for (const u of r.datos.usuarios.filter((x) => x.activo && x.id.toLowerCase() !== sesion.id.toLowerCase())) {
          selectorTitular.append(el('option', { value: u.id }, u.nombre));
        }
      }
      selectorTitular.disabled = false;
    });
  }
}

/** "2026-10-19 C2 10:00-11:00" -> "lunes 19 de octubre, Consultorio 2, 10:00 a 11:00" */
export function textoMovidaDesde(reglas, valor) {
  const m = /^(\d{4}-\d{2}-\d{2}) C(\d+) (\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(valor || '');
  if (!m) return valor || '';
  return `${fechaLarga(m[1])}, ${nombreSala(reglas, Number(m[2]))}, ${m[3]} a ${m[4]}`;
}

/**
 * Hoja con el detalle de una reserva y las opciones de moverla o cancelarla.
 * `alCancelada` se llama también después de mover, para que quien la abrió actualice su lista.
 */
export function abrirHojaDetalle({ reglas, sesion, api, reserva, alCancelada }) {
  const administrativo = esAdministrativo(sesion.rol);
  const esBloqueo = reserva.tipo === 'bloqueo';
  const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
  const zonaAccion = el('div', {});

  const filas = [
    el('dt', {}, 'Consultorio'), el('dd', {}, etiquetaSala(reglas, reserva.consultorio)),
    el('dt', {}, 'Día'), el('dd', {}, fechaLarga(reserva.fecha)),
    el('dt', {}, 'Horario'), el('dd', {}, rangoHoras(reserva.inicioMin, reserva.finMin)),
  ];
  if (!esBloqueo && reserva.titularNombre) filas.push(el('dt', {}, 'A nombre de'), el('dd', {}, reserva.titularNombre));
  if (administrativo && reserva.creadaPor) filas.push(el('dt', {}, 'Realizada por'), el('dd', {}, reserva.creadaPor));
  if (esBloqueo && reserva.observacion) filas.push(el('dt', {}, 'Motivo'), el('dd', {}, reserva.observacion));
  if (!esBloqueo && reserva.movidaDesde) filas.push(el('dt', {}, 'Movida desde'), el('dd', {}, textoMovidaDesde(reglas, reserva.movidaDesde)));

  const mostrarBoton = () => {
    reemplazarHijos(
      zonaAccion,
      el(
        'div',
        { clase: 'hoja-acciones' },
        esBloqueo ? null : el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => abrirHojaMover({ reglas, sesion, api, reserva, alMovida: () => { hoja.cerrar(); alCancelada(); } }) }, 'Mover'),
        el('button', { clase: 'boton boton-secundario', type: 'button', enClick: pedirConfirmacion }, esBloqueo ? 'Quitar bloqueo' : 'Cancelar reserva'),
        el('button', { clase: 'boton boton-texto', type: 'button', enClick: () => hoja.cerrar() }, 'Cerrar')
      ),
      !administrativo && !esBloqueo ? el('p', { clase: 'campo-ayuda' }, `Se puede mover o cancelar hasta ${reglas.cancelacion.horasAntelacion} horas antes del inicio.`) : null
    );
  };

  const pedirConfirmacion = () => {
    mensaje.hidden = true;
    const confirmar = el('button', { clase: 'boton boton-peligro', type: 'button' }, esBloqueo ? 'Sí, quitar' : 'Sí, cancelar');
    confirmar.addEventListener('click', async () => {
      confirmar.disabled = true;
      confirmar.textContent = 'Cancelando…';
      const r = await api.cancelar(reserva.id);
      if (r.ok) {
        mostrarAviso(esBloqueo ? 'Bloqueo quitado.' : 'Reserva cancelada.');
        hoja.cerrar();
        alCancelada();
        return;
      }
      mensaje.replaceChildren(r.error.mensaje);
      mensaje.hidden = false;
      mostrarBoton();
    });
    reemplazarHijos(
      zonaAccion,
      el(
        'div',
        { clase: 'confirmacion' },
        el('p', {}, esBloqueo ? '¿Quitar este bloqueo?' : '¿Cancelar esta reserva? El horario quedará libre para otras personas.'),
        el('div', { clase: 'hoja-acciones' }, confirmar, el('button', { clase: 'boton boton-secundario', type: 'button', enClick: mostrarBoton }, 'No, volver'))
      )
    );
    confirmar.focus();
  };

  mostrarBoton();
  const hoja = abrirHoja({
    titulo: esBloqueo ? 'Horario bloqueado' : 'Reserva',
    cuerpo: [el('dl', { clase: 'datos' }, filas), mensaje, zonaAccion],
  });
}

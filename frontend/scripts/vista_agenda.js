// Agenda: grilla de reservas por día. En notebook se ven todos los consultorios; en celular, uno por vez.

import {
  el, icono, ahoraEn, sumarDias, diaDeSemana, lunesDeLaSemana, fechaLarga, nombreDiaCorto, numeroDia, mesYAnio, capitalizar,
  minutosAHora, rangoHoras, horarioDelDia, nombreSala, colorSala,
} from './utilidades.js';
import { abrirHojaReserva, abrirHojaDetalle } from './hojas_reservas.js';
import { mostrarAviso } from './hojas.js';

const INTERVALO_ACTUALIZACION_MS = 60000;

export function crearVistaAgenda({ api, reglas, sesion }) {
  const administrativo = sesion.rol === 'admin' || sesion.rol === 'gestor';
  const totalSalas = reglas.espacios.cantidad;
  const todasLasSalas = Array.from({ length: totalSalas }, (_, i) => i + 1);
  // Espacios habilitados del usuario (sesiones abiertas con la versión anterior traían "consPref").
  const habilitadas = (Array.isArray(sesion.espHabil) && sesion.espHabil.length ? sesion.espHabil : sesion.consPref) || todasLasSalas;

  /** Administración y gestión ven todos los consultorios; un usuario, los habilitados y los de sus propias reservas del día. */
  function salasDelDia() {
    if (administrativo) return todasLasSalas;
    const propias = reservas.filter((r) => r.propia === true).map((r) => r.consultorio);
    return todasLasSalas.filter((n) => habilitadas.includes(n) || propias.includes(n));
  }
  const consulta = window.matchMedia('(max-width: 760px)');
  const hoy = () => ahoraEn(reglas.zonaHoraria);

  let fecha = siguienteLaboral(hoy().fecha, 1);
  let reservas = [];
  let cargando = true;
  let error = null;
  let salaActiva = habilitadas[0] || 1;
  let activa = false;
  let temporizador = null;
  let idPeticion = 0;

  const nodo = el('section', { clase: 'agenda', 'aria-label': 'Agenda de reservas' });
  const zonaCabecera = el('div', { clase: 'agenda-cabecera' });
  const zonaGrilla = el('div', { clase: 'grilla', role: 'group', 'aria-label': 'Horarios por consultorio' });
  const zonaNota = el('p', { clase: 'agenda-nota' });
  nodo.append(zonaCabecera, zonaGrilla, zonaNota);

  // ---------- Fechas navegables ----------

  function esLaboral(f) {
    return reglas.diasLaborales.includes(diaDeSemana(f));
  }

  function siguienteLaboral(desde, sentido) {
    let f = desde;
    for (let i = 0; i < 8 && !esLaboral(f); i += 1) f = sumarDias(f, sentido);
    return f;
  }

  function limites() {
    const h = hoy().fecha;
    return {
      minima: administrativo ? sumarDias(h, -60) : h,
      maxima: sesion.rol === 'admin' ? sumarDias(h, 365) : sumarDias(h, reglas.reserva.maxSemanasAdelante * 7),
    };
  }

  function irA(destino, sentido = 1) {
    const { minima, maxima } = limites();
    let f = siguienteLaboral(destino, sentido);
    if (f < minima) f = siguienteLaboral(minima, 1);
    if (f > maxima) f = siguienteLaboral(maxima, -1);
    if (f === fecha) return;
    fecha = f;
    cargar();
  }

  function moverDia(sentido) {
    irA(sumarDias(fecha, sentido), sentido);
  }

  // ---------- Carga de datos ----------

  async function cargar({ silencioso = false } = {}) {
    const mia = ++idPeticion;
    if (!silencioso) {
      cargando = true;
      error = null;
      dibujar();
    }
    const r = await api.agenda(fecha);
    if (mia !== idPeticion) return; // llegó tarde: ya se pidió otro día
    cargando = false;
    if (r.ok) {
      reservas = r.datos.reservas;
      error = null;
    } else {
      error = r;
      if (!silencioso) reservas = [];
    }
    dibujar();
  }

  // ---------- Dibujo ----------

  function dibujarCabecera() {
    const { minima, maxima } = limites();
    const entrada = el('input', { type: 'date', value: fecha, min: minima, max: maxima, 'aria-label': 'Elegir otra fecha' });
    entrada.addEventListener('change', () => {
      if (entrada.value) irA(entrada.value, 1);
    });

    const lunes = lunesDeLaSemana(fecha);
    const dias = [];
    for (let i = 0; i < 7; i += 1) {
      const f = sumarDias(lunes, i);
      if (!esLaboral(f)) continue;
      const fueraDeRango = f < minima || f > maxima;
      const boton = el(
        'button',
        {
          clase: `dia${f === hoy().fecha ? ' es-hoy' : ''}`, type: 'button', disabled: fueraDeRango,
          'aria-pressed': f === fecha, 'aria-label': fechaLarga(f), enClick: () => irA(f),
        },
        el('span', { clase: 'dia-nombre' }, nombreDiaCorto(f)),
        el('span', { clase: 'dia-numero' }, numeroDia(f))
      );
      dias.push(boton);
    }

    const esHoy = fecha === hoy().fecha;
    zonaCabecera.replaceChildren(
      el(
        'div',
        { clase: 'agenda-fila' },
        el('h1', { clase: 'fecha-actual' }, capitalizar(fechaLarga(fecha)), el('small', {}, esHoy ? 'Hoy' : capitalizar(mesYAnio(fecha)))),
        el(
          'div',
          { clase: 'nav-fecha' },
          el('button', { clase: 'boton-icono', type: 'button', 'aria-label': 'Día anterior', disabled: fecha <= siguienteLaboral(minima, 1), enClick: () => moverDia(-1) }, icono('anterior')),
          el('button', { clase: 'boton-icono', type: 'button', 'aria-label': 'Día siguiente', disabled: fecha >= siguienteLaboral(maxima, -1), enClick: () => moverDia(1) }, icono('siguiente')),
          el('button', { clase: 'boton', type: 'button', disabled: esHoy, enClick: () => irA(hoy().fecha) }, 'Hoy'),
          el('span', { clase: 'selector-fecha' }, el('span', { clase: 'boton-icono' }, icono('calendario')), entrada)
        )
      ),
      el('div', { clase: 'tira-dias' }, dias),
      el(
        'div',
        { clase: 'agenda-leyenda' },
        el('span', { clase: 'leyenda-item' }, el('span', { clase: 'leyenda-muestra' }), 'Libre'),
        el('span', { clase: 'leyenda-item' }, el('span', { clase: 'leyenda-muestra l-ocupado' }), 'Ocupado'),
        el('span', { clase: 'leyenda-item' }, el('span', { clase: 'leyenda-muestra l-propio' }), administrativo ? 'Reservas' : 'Tus reservas')
      )
    );
  }

  function dibujarGrilla() {
    zonaGrilla.setAttribute('aria-busy', String(cargando));
    const horario = horarioDelDia(reglas, fecha);
    if (!horario) {
      zonaGrilla.replaceChildren(el('div', { clase: 'grilla-estado' }, 'Ese día no hay atención.'));
      return;
    }

    const movil = consulta.matches;
    const salas = salasDelDia();
    if (!salas.includes(salaActiva)) salaActiva = salas[0];
    const visibles = movil ? [salaActiva] : salas;
    const tramo = reglas.tramoMinutos;
    const filas = Math.ceil((horario.fin - horario.inicio) / tramo);
    const ahora = hoy();
    const ponerColumnas = (nodoGrilla) => {
      nodoGrilla.style.setProperty('--salas', String(visibles.length));
    };

    // Encabezado (se queda pegado arriba al hacer scroll)
    const encabezado = el('div', { clase: 'grilla-encabezado' });
    ponerColumnas(encabezado);
    if (movil) {
      const selector = el('div', { clase: 'salas-selector', role: 'group', 'aria-label': 'Consultorio' }, el('span', { clase: 'selector-etiqueta' }, 'Consultorio'));
      for (const s of salas) {
        const boton = el('button', { clase: 'sala-boton', type: 'button', 'aria-pressed': s === salaActiva, 'aria-label': nombreSala(reglas, s), enClick: () => { salaActiva = s; dibujar(); } }, String(s));
        boton.style.setProperty('--sala-color', colorSala(s));
        selector.append(boton);
      }
      encabezado.append(selector);
      encabezado.style.gridTemplateColumns = '1fr';
    } else {
      encabezado.append(el('div', { clase: 'encabezado-esquina' }, 'Hora'));
      for (const s of salas) {
        const punto = el('span', { clase: 'punto' });
        punto.style.setProperty('--sala-color', colorSala(s));
        encabezado.append(el('div', { clase: 'sala-titulo' }, punto, el('span', {}, nombreSala(reglas, s))));
      }
    }

    // Cuerpo
    const cuerpo = el('div', { clase: 'grilla-cuerpo' });
    ponerColumnas(cuerpo);
    cuerpo.style.setProperty('--filas', String(filas));

    const columnaDe = (sala) => visibles.indexOf(sala) + 2;
    const cubiertas = new Set(); // "sala:fila" de celdas tapadas por una reserva
    const bloques = [];

    for (const r of reservas) {
      const fila0 = Math.max(0, Math.floor((r.inicioMin - horario.inicio) / tramo));
      const fila1 = Math.min(filas, Math.ceil((r.finMin - horario.inicio) / tramo));
      if (fila1 <= fila0) continue;
      const afectadas = r.consultorio === 0 ? visibles : visibles.filter((s) => s === r.consultorio);
      if (afectadas.length === 0) continue;
      for (const s of afectadas) for (let f = fila0; f < fila1; f += 1) cubiertas.add(`${s}:${f}`);
      bloques.push({ r, fila0, fila1, afectadas });
    }

    for (let f = 0; f < filas; f += 1) {
      const minutos = horario.inicio + f * tramo;
      const enPunto = minutos % 60 === 0;
      if (enPunto) {
        const etiqueta = el('div', { clase: 'hora-etiqueta' }, minutosAHora(minutos));
        etiqueta.style.gridRow = `${f + 1} / span ${Math.min(2, filas - f)}`;
        cuerpo.append(etiqueta);
      }
      const pasada = fecha === ahora.fecha && minutos + tramo <= ahora.minutos || fecha < ahora.fecha;
      for (const s of visibles) {
        if (cubiertas.has(`${s}:${f}`)) continue;
        const bloqueada = pasada && !administrativo;
        const celda = el('button', {
          clase: `celda${enPunto ? ' hora-en-punto' : ''}${pasada ? ' pasada' : ''}`, type: 'button', disabled: bloqueada,
          'aria-label': `${nombreSala(reglas, s)}, ${minutosAHora(minutos)}, libre`,
          enClick: () => reservarDesde(s, minutos),
        });
        celda.style.gridColumn = String(columnaDe(s));
        celda.style.gridRow = String(f + 1);
        cuerpo.append(celda);
      }
    }

    for (const { r, fila0, fila1, afectadas } of bloques) cuerpo.append(crearBloque(r, fila0, fila1, afectadas, columnaDe));

    if (fecha === ahora.fecha && ahora.minutos >= horario.inicio && ahora.minutos < horario.fin) {
      const linea = el('div', { clase: 'linea-ahora', 'aria-hidden': 'true' });
      linea.style.top = `calc(var(--alto-tramo) * ${(ahora.minutos - horario.inicio) / tramo})`;
      cuerpo.append(linea);
    }

    zonaGrilla.replaceChildren(encabezado, cuerpo);
  }

  function crearBloque(r, fila0, fila1, afectadas, columnaDe) {
    const detalle = r.ocupado === false || r.id !== undefined;
    const propio = detalle && r.propia === true;
    const esBloqueo = detalle && r.tipo === 'bloqueo';

    let clase = 'bloque bloque-ocupado';
    let titulo = 'Ocupado';
    if (esBloqueo) {
      clase = 'bloque bloque-bloqueo';
      titulo = r.observacion ? `Bloqueado · ${r.observacion}` : 'Bloqueado';
    } else if (propio) {
      clase = 'bloque bloque-propio';
      titulo = 'Tu reserva';
    } else if (detalle) {
      clase = 'bloque bloque-detalle';
      titulo = r.titularNombre || 'Reserva';
    }

    const filas = fila1 - fila0;
    const interactivo = detalle;
    const bloque = el(
      interactivo ? 'button' : 'div',
      {
        clase, ...(interactivo ? { type: 'button' } : {}),
        'aria-label': `${nombreSala(reglas, r.consultorio)}, ${rangoHoras(r.inicioMin, r.finMin)}, ${titulo}`,
        enClick: interactivo ? () => abrirHojaDetalle({ reglas, sesion, api, reserva: r, alCancelada: () => cargar({ silencioso: true }) }) : null,
      },
      el('span', { clase: 'bloque-titulo' }, titulo),
      filas >= 2 || !esBloqueo ? el('span', { clase: 'bloque-hora' }, `${minutosAHora(r.inicioMin)} – ${minutosAHora(r.finMin)}`) : null
    );
    bloque.style.gridRow = `${fila0 + 1} / ${fila1 + 1}`;
    bloque.style.gridColumn = afectadas.length > 1 ? `${columnaDe(afectadas[0])} / ${columnaDe(afectadas[afectadas.length - 1]) + 1}` : String(columnaDe(afectadas[0]));
    bloque.style.setProperty('--sala-color', colorSala(r.consultorio));
    return bloque;
  }

  function dibujarEstado() {
    if (error && reservas.length === 0) {
      zonaGrilla.replaceChildren(
        el(
          'div',
          { clase: 'grilla-estado' },
          el('div', { clase: 'mensaje-error', role: 'alert' }, error.error.mensaje, error.detalle ? el('p', { clase: 'detalle-tecnico' }, error.detalle.join(' · ')) : null),
          el('div', {}, el('button', { clase: 'boton boton-primario', type: 'button', enClick: () => cargar() }, 'Reintentar'))
        )
      );
      return true;
    }
    if (cargando && reservas.length === 0) {
      zonaGrilla.replaceChildren(el('div', { clase: 'grilla-estado', role: 'status' }, 'Cargando agenda…'));
      return true;
    }
    return false;
  }

  function dibujarNota() {
    const { maxima } = limites();
    zonaNota.textContent = sesion.rol === 'admin'
      ? ''
      : `Podés reservar hasta el ${fechaLarga(maxima)}. Para fechas posteriores, comunicate con la secretaría.`;
  }

  function dibujar() {
    dibujarCabecera();
    if (!dibujarEstado()) dibujarGrilla();
    dibujarNota();
  }

  function reservarDesde(sala, inicioMin) {
    const horario = horarioDelDia(reglas, fecha);
    const minimo = Math.min(...reglas.duracionesMinutos);
    const hasta = horario.fin;
    const libre = (desde, hastaMin) =>
      !reservas.some((r) => (r.consultorio === sala || r.consultorio === 0) && r.inicioMin < hastaMin && desde < r.finMin);
    if (inicioMin + minimo > hasta || !libre(inicioMin, inicioMin + minimo)) {
      mostrarAviso(`Desde las ${minutosAHora(inicioMin)} no hay ${minimo} minutos libres. Probá con otro horario.`, 'error');
      return;
    }
    abrirHojaReserva({
      reglas, sesion, api,
      contexto: { consultorio: sala, fecha, inicioMin, reservas, ahora: hoy() },
      alReservado: () => cargar({ silencioso: true }),
    });
  }

  // ---------- Ciclo de vida ----------

  const alCambiarTamano = () => { if (activa) dibujar(); };
  const alVolver = () => { if (activa && document.visibilityState === 'visible') cargar({ silencioso: true }); };
  consulta.addEventListener('change', alCambiarTamano);
  document.addEventListener('visibilitychange', alVolver);

  return {
    nodo,
    activar() {
      activa = true;
      cargar();
      temporizador = setInterval(() => { if (document.visibilityState === 'visible') cargar({ silencioso: true }); }, INTERVALO_ACTUALIZACION_MS);
    },
    desactivar() {
      activa = false;
      clearInterval(temporizador);
      idPeticion += 1;
    },
    destruir() {
      this.desactivar();
      consulta.removeEventListener('change', alCambiarTamano);
      document.removeEventListener('visibilitychange', alVolver);
    },
  };
}

// Utilidades de la interfaz: crear elementos, fechas y horas.
// Las fechas son texto 'AAAA-MM-DD' y las horas 'HH:MM'; el día "de hoy" se calcula en la zona de Montevideo,
// no en la del dispositivo.

export function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    // Los atributos aria-* llevan siempre el texto "true" o "false" (no son atributos de presencia).
    if (nombre.startsWith('aria-') && typeof valor === 'boolean') {
      nodo.setAttribute(nombre, String(valor));
      continue;
    }
    if (valor === undefined || valor === null || valor === false) continue;
    if (nombre === 'clase') nodo.className = valor;
    else if (nombre === 'datos') Object.assign(nodo.dataset, valor);
    else if (nombre.startsWith('en') && typeof valor === 'function') nodo.addEventListener(nombre.slice(2).toLowerCase(), valor);
    else nodo.setAttribute(nombre, valor === true ? '' : String(valor));
  }
  for (const hijo of hijos.flat()) {
    if (hijo === undefined || hijo === null || hijo === false) continue;
    nodo.append(typeof hijo === 'object' && hijo.nodeType ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

/** Reemplaza el contenido de un nodo ignorando los valores vacíos (replaceChildren escribiría "null" como texto). */
export function reemplazarHijos(nodo, ...hijos) {
  nodo.replaceChildren(...hijos.flat().filter((h) => h !== null && h !== undefined && h !== false));
}

const ICONOS = {
  anterior: '<path d="M15 5l-7 7 7 7"/>',
  siguiente: '<path d="M9 5l7 7-7 7"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  lista: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
  agenda: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9h17M9 9v11"/>',
  gestion: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
};

export function icono(nombre) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icono');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONOS[nombre] || '';
  return svg;
}

// ---------- Fechas ----------

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function partes(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return { a, m, d };
}

export function ahoraEn(zonaHoraria, instante = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(instante)
      .map((x) => [x.type, x.value])
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

export function sumarDias(fecha, cantidad) {
  const { a, m, d } = partes(fecha);
  return new Date(Date.UTC(a, m - 1, d + cantidad)).toISOString().slice(0, 10);
}

export function diaDeSemana(fecha) {
  const { a, m, d } = partes(fecha);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function lunesDeLaSemana(fecha) {
  return sumarDias(fecha, -((diaDeSemana(fecha) + 6) % 7));
}

/** "lunes 19 de octubre" */
export function fechaLarga(fecha) {
  const { m, d } = partes(fecha);
  return `${DIAS[diaDeSemana(fecha)]} ${d} de ${MESES[m - 1]}`;
}

export function nombreDia(fecha) {
  return DIAS[diaDeSemana(fecha)];
}

export function nombreDiaCorto(fecha) {
  return DIAS[diaDeSemana(fecha)].slice(0, 3);
}

export function numeroDia(fecha) {
  return String(partes(fecha).d);
}

export function mesYAnio(fecha) {
  const { a, m } = partes(fecha);
  return `${MESES[m - 1]} de ${a}`;
}

// ---------- Horas ----------

export function minutosAHora(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

export function horaAMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export function rangoHoras(inicioMin, finMin) {
  return `${minutosAHora(inicioMin)} a ${minutosAHora(finMin)}`;
}

// ---------- Reglas del día (mismas que el servidor; acá solo sirven para mostrar mejor) ----------

export function horarioDelDia(reglas, fecha) {
  const dia = diaDeSemana(fecha);
  if (!reglas.diasLaborales.includes(dia)) return null;
  const h = (reglas.horariosEspeciales && reglas.horariosEspeciales[String(dia)]) || reglas.horario;
  return { inicio: horaAMinutos(h.inicio), fin: horaAMinutos(h.fin) };
}

export function nombreSala(reglas, numero) {
  return numero === 0 ? 'Todos los consultorios' : `${reglas.espacios.etiqueta} ${numero}`;
}

export function colorSala(numero) {
  return numero >= 1 && numero <= 5 ? `var(--sala-${numero})` : 'var(--tinta-suave)';
}

export function etiquetaRol(rol) {
  return { usuario: 'Usuario', gestor: 'Gestión', admin: 'Administración' }[rol] || rol;
}

export function iniciales(nombre) {
  const palabras = String(nombre || '?').trim().split(/\s+/);
  return (palabras[0][0] + (palabras.length > 1 ? palabras[palabras.length - 1][0] : '')).toUpperCase();
}

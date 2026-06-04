// El Gran Test Grafológico — clave alfanumérica A-L / 1-12 del método.
// V1 estático: tabla explicativa de las tres grandes facultades. La
// auto-evaluación interactiva (interpretación de claves tachadas) es
// propiedad intelectual del autor y se publicará solo si éste facilita
// el algoritmo (V2).
import { trazos } from './trazos'

export const instrucciones =
  'Compruebe si las letras y números de su clave que no están tachados coinciden con alguna de las claves de los calificativos que componen las listas. En caso afirmativo, usted puede atribuirse ese calificativo; por el contrario, en caso de que la coincidencia sea con las letras y números que están tachados, su personalidad no sólo no tendrá ese calificativo sino que tendrá todo lo contrario. Cuando coincidan sólo algunos números o letras y otros no, indicaría que ese calificativo no es un dato relevante en su personalidad. Conforme vaya siendo menor la coincidencia, también será menor la similitud psicológica.'

export const claveCompleta = {
  letras: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
  numeros: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

// Las tres grandes facultades — agrupación de esencias (letras) y trazos (números).
export const facultades = [
  {
    id: 'inteligencia',
    nombre: 'La Inteligencia',
    letras: 'ABCD',
    numeros: [1, 4, 7, 10],
    descripcion:
      'Si reúne toda la clave, tiene usted una inteligencia superdotada. Facilidad para los estudios, las ciencias, las artes, la profundidad filosófica, etc.',
  },
  {
    id: 'sentimiento',
    nombre: 'El Sentimiento',
    letras: 'EFGH',
    numeros: [2, 5, 8, 11],
    descripcion:
      'Si tiene toda la clave es usted una persona muy equilibrada. Magnánimo, natural, y puede decirse de usted que ama al prójimo como a su propia persona.',
  },
  {
    id: 'voluntad',
    nombre: 'La Voluntad',
    letras: 'IJKL',
    numeros: [3, 6, 9, 12],
    descripcion:
      'Con toda la clave, es usted una persona con una extraordinaria fuerza de voluntad; no hay nada en el mundo que le impida hacer aquello que siente o desea.',
  },
]

// Trazos de cada facultad, derivados de trazos.js (sin duplicar datos).
export function trazosDeFacultad(facultadId) {
  return trazos.filter((t) => t.grupo === facultadId)
}

import JsonModel from '../../database/JsonModel.js';

const defaults = {
  nombre: 'Coppa',
  prefix: 'coppa',
  estado: 'EnCurso', // 'EnCurso', 'Finalizado'
  tema: {
    primario: '#022c16',
    secundario: '#064e3b',
    acento: '#4ade80',
    texto: '#ffffff',
    borde: '#059669',
  },
  tipoEncuentro: 'ida_vuelta',
  hayTercerPuesto: false,
  fasesEliminatoria: [],
  equipos: [],
  llaves: {},
  faseActual: 0,
  createdBy: null
};

export default new JsonModel('Coppa', defaults);

import JsonModel from '../database/JsonModel.js';

const defaults = {
  nombre: '',
  id: '',
  avatar: '',
  ligaActual: 'Sin Liga',
  titulos: {
    oficiales: [],
    amistosos: []
  },
  partidosGanadosHistorico: 0,
  partidosPerdidosHistorico: 0,
  woHistorico: 0,
  golesAFavorHistorico: 0,
  golesEnContraHistorico: 0,
  historial: [],
  aliases: []
};

export default new JsonModel('Jugador', defaults);
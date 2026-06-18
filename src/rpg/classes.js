// Clases jugables + el personaje GOD (Cernunnos/Diosito). La autenticacion y la
// exclusividad del GOD las valida el SERVER (cuenta zpw, hash en el entorno); el
// cliente solo conoce la definicion del personaje, NUNCA el password.

// Las 4 clases que un jugador normal puede elegir. char = archivo KayKit.
export const CLASSES = {
  guerrero:    { id: 'guerrero',    name: 'Guerrero',    char: 'char_knight.glb',       emoji: '🛡️', rol: 'Tanque / cuerpo a cuerpo' },
  mago:        { id: 'mago',        name: 'Mago',        char: 'char_mage.glb',         emoji: '🔮', rol: 'Daño mágico de área' },
  arquero:     { id: 'arquero',     name: 'Arquero',     char: 'char_ranger.glb',       emoji: '🏹', rol: 'Daño a distancia' },
  encapuchado: { id: 'encapuchado', name: 'Encapuchado', char: 'char_rogue_hooded.glb', emoji: '🥷', rol: 'Sanador / soporte' },
};

export const CLASS_LIST = Object.values(CLASSES);

// El personaje GOD (Cernunnos/Diosito): puede usar cualquier arma y todas las skills.
// Solo lo desbloquea la cuenta zpw, cuya validacion vive en el SERVER (no aqui).
export const CERNUNNOS = {
  id: 'cernunnos',
  name: 'Diosito',
  char: 'char_cernunnos.glb',
  emoji: '🦌',
  rol: 'GOD · todas las habilidades, cualquier arma',
  god: true,
  auraColor: 0x9be8b0, // verde pastel del aura en el piso
};

// (La validacion del GOD vive en el server: el cliente NO conoce el password.)

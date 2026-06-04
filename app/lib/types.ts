// Tipos de transferencia (DTO) que viajan del servidor a los componentes cliente del
// tablero. Son deliberadamente mínimos y serializables (solo lo que la UI necesita).

export type CardDTO = {
  id: string;
  title: string;
  position: string;
};

export type ListDTO = {
  id: string;
  title: string;
  position: string;
  cards: CardDTO[];
};

export type BoardDTO = {
  id: string;
  title: string;
  lists: ListDTO[];
};
